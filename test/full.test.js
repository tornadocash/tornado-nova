const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(process.env.MINIMUM_WITHDRAWAL_AMOUNT || '0.05')
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('TornadoPool', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT,
    )
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000'))

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig }
  }

  describe('Upgradeability tests', () => {
    it('admin should be gov', async () => {
      const { proxy, amb, gov } = await loadFixture(fixture)
      const { data } = await proxy.populateTransaction.admin()
      const { result } = await amb.callStatic.execute([{ who: proxy.address, callData: data }])
      expect('0x' + result.slice(26)).to.be.equal(gov.address.toLowerCase())
    })

    it('non admin cannot call', async () => {
      const { proxy } = await loadFixture(fixture)
      await expect(proxy.admin()).to.be.revertedWith(
        "Transaction reverted: function selector was not recognized and there's no fallback function",
      )
    })

    it('should configure', async () => {
      const { tornadoPool, amb } = await loadFixture(fixture)
      const newWithdrawalLimit = utils.parseEther('0.01337')
      const newDepositLimit = utils.parseEther('1337')

      const { data } = await tornadoPool.populateTransaction.configureLimits(
        newWithdrawalLimit,
        newDepositLimit,
      )

      await amb.execute([{ who: tornadoPool.address, callData: data }])

      expect(await tornadoPool.maximumDepositAmount()).to.be.equal(newDepositLimit)
      expect(await tornadoPool.minimalWithdrawalAmount()).to.be.equal(newWithdrawalLimit)
    })
  })

  it('encrypt -> decrypt should work', () => {
    const data = Buffer.from([0xff, 0xaa, 0x00, 0x01])
    const keypair = new Keypair()

    const ciphertext = keypair.encrypt(data)
    const result = keypair.decrypt(ciphertext)
    expect(result).to.be.deep.equal(data)
  })

  it('constants check', async () => {
    const { tornadoPool } = await loadFixture(fixture)
    const maxFee = await tornadoPool.MAX_FEE()
    const maxExtAmount = await tornadoPool.MAX_EXT_AMOUNT()
    const fieldSize = await tornadoPool.FIELD_SIZE()

    expect(maxExtAmount.add(maxFee)).to.be.lt(fieldSize)
  })

  it('should register and deposit', async function () {
    let { tornadoPool } = await loadFixture(fixture)
    const sender = (await ethers.getSigners())[0]

    // Alice deposits into tornado pool
    const aliceDepositAmount = 1e7
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })

    tornadoPool = tornadoPool.connect(sender)
    await registerAndTransact({
      tornadoPool,
      outputs: [aliceDepositUtxo],
      account: {
        owner: sender.address,
        publicKey: aliceDepositUtxo.keypair.address(),
      },
    })

    const filter = tornadoPool.filters.NewCommitment()
    const fromBlock = await ethers.provider.getBlock()
    const events = await tornadoPool.queryFilter(filter, fromBlock.number)

    let aliceReceiveUtxo
    try {
      aliceReceiveUtxo = Utxo.decrypt(
        aliceDepositUtxo.keypair,
        events[0].args.encryptedOutput,
        events[0].args.index,
      )
    } catch (e) {
      // we try to decrypt another output here because it shuffles outputs before sending to blockchain
      aliceReceiveUtxo = Utxo.decrypt(
        aliceDepositUtxo.keypair,
        events[1].args.encryptedOutput,
        events[1].args.index,
      )
    }
    expect(aliceReceiveUtxo.amount).to.be.equal(aliceDepositAmount)

    const filterRegister = tornadoPool.filters.PublicKey(sender.address)
    const filterFromBlock = await ethers.provider.getBlock()
    const registerEvents = await tornadoPool.queryFilter(filterRegister, filterFromBlock.number)

    const [registerEvent] = registerEvents.sort((a, b) => a.blockNumber - b.blockNumber).slice(-1)

    expect(registerEvent.args.key).to.be.equal(aliceDepositUtxo.keypair.address())
  })

  it('should deposit, transact and withdraw', async function () {
    const { tornadoPool, token } = await loadFixture(fixture)

    // Alice deposits into tornado pool
    const aliceDepositAmount = utils.parseEther('0.1')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })
    await transaction({ tornadoPool, outputs: [aliceDepositUtxo] })

    // Bob gives Alice address to send some eth inside the shielded pool
    const bobKeypair = new Keypair() // contains private and public keys
    const bobAddress = bobKeypair.address() // contains only public key

    // Alice sends some funds to Bob
    const bobSendAmount = utils.parseEther('0.06')
    const bobSendUtxo = new Utxo({ amount: bobSendAmount, keypair: Keypair.fromString(bobAddress) })
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(bobSendAmount),
      keypair: aliceDepositUtxo.keypair,
    })
    await transaction({ tornadoPool, inputs: [aliceDepositUtxo], outputs: [bobSendUtxo, aliceChangeUtxo] })

    // Bob parses chain to detect incoming funds
    const filter = tornadoPool.filters.NewCommitment()
    const fromBlock = await ethers.provider.getBlock()
    const events = await tornadoPool.queryFilter(filter, fromBlock.number)
    let bobReceiveUtxo
    try {
      bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args.encryptedOutput, events[0].args.index)
    } catch (e) {
      // we try to decrypt another output here because it shuffles outputs before sending to blockchain
      bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[1].args.encryptedOutput, events[1].args.index)
    }
    expect(bobReceiveUtxo.amount).to.be.equal(bobSendAmount)

    // Bob withdraws a part of his funds from the shielded pool
    const bobWithdrawAmount = utils.parseEther('0.05')
    const bobEthAddress = '0xDeaD00000000000000000000000000000000BEEf'
    const bobChangeUtxo = new Utxo({ amount: bobSendAmount.sub(bobWithdrawAmount), keypair: bobKeypair })
    await transaction({
      tornadoPool,
      inputs: [bobReceiveUtxo],
      outputs: [bobChangeUtxo],
      recipient: bobEthAddress,
    })

    const bobBalance = await token.balanceOf(bobEthAddress)
    expect(bobBalance).to.be.equal(bobWithdrawAmount)
  })

  it('should deposit from L1 and withdraw to L1', async function () {
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
    const aliceKeypair = new Keypair() // contains private and public keys

    // Alice deposits into tornado pool
    const aliceDepositAmount = utils.parseEther('0.07')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount, keypair: aliceKeypair })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })

    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    })

    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      aliceDepositUtxo.amount,
      onTokenBridgedData,
    )
    // emulating bridge. first it sends tokens to omnibridge mock then it sends to the pool
    await token.transfer(omniBridge.address, aliceDepositAmount)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // call onTokenBridgedTx
    ])

    // withdraws a part of his funds from the shielded pool
    const aliceWithdrawAmount = utils.parseEther('0.06')
    const recipient = '0xDeaD00000000000000000000000000000000BEEf'
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(aliceWithdrawAmount),
      keypair: aliceKeypair,
    })
    await transaction({
      tornadoPool,
      inputs: [aliceDepositUtxo],
      outputs: [aliceChangeUtxo],
      recipient: recipient,
      isL1Withdrawal: true,
    })

    const recipientBalance = await token.balanceOf(recipient)
    expect(recipientBalance).to.be.equal(0)
    const omniBridgeBalance = await token.balanceOf(omniBridge.address)
    expect(omniBridgeBalance).to.be.equal(aliceWithdrawAmount)
  })

  it('should transfer funds to multisig in case of L1 deposit fail', async function () {
    const { tornadoPool, token, omniBridge, multisig } = await loadFixture(fixture)
    const aliceKeypair = new Keypair() // contains private and public keys

    // Alice deposits into tornado pool
    const aliceDepositAmount = utils.parseEther('0.07')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount, keypair: aliceKeypair })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })

    args.proof = args.proof.slice(0, -2)

    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    })

    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      aliceDepositUtxo.amount,
      onTokenBridgedData,
    )
    // emulating bridge. first it sends tokens to omnibridge mock then it sends to the pool
    await token.transfer(omniBridge.address, aliceDepositAmount)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)

    const lastRoot = await tornadoPool.getLastRoot()
    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // call onTokenBridgedTx
    ])

    const multisigBalance = await token.balanceOf(multisig.address)
    expect(multisigBalance).to.be.equal(aliceDepositAmount)
    expect(await tornadoPool.getLastRoot()).to.be.equal(lastRoot)
  })

  it('should revert if onTransact called directly', async () => {
    const { tornadoPool } = await loadFixture(fixture)
    const aliceKeypair = new Keypair() // contains private and public keys

    // Alice deposits into tornado pool
    const aliceDepositAmount = utils.parseEther('0.07')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount, keypair: aliceKeypair })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })

    await expect(tornadoPool.onTransact(args, extData)).to.be.revertedWith(
      'can be called only from onTokenBridged',
    )
  })

  it('should work with 16 inputs', async function () {
    const { tornadoPool } = await loadFixture(fixture)
    const aliceDepositAmount = utils.parseEther('0.07')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })
    await transaction({
      tornadoPool,
      inputs: [new Utxo(), new Utxo(), new Utxo()],
      outputs: [aliceDepositUtxo],
    })
  })

  it('should be compliant', async function () {
    // basically verifier should check if a commitment and a nullifier hash are on chain
    const { tornadoPool } = await loadFixture(fixture)
    const aliceDepositAmount = utils.parseEther('0.07')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })
    const [sender] = await ethers.getSigners()

    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })
    const receipt = await tornadoPool.transact(args, extData, {
      gasLimit: 2e6,
    })
    await receipt.wait()

    // withdrawal
    await transaction({
      tornadoPool,
      inputs: [aliceDepositUtxo],
      outputs: [],
      recipient: sender.address,
    })

    const tree = await buildMerkleTree({ tornadoPool })
    const commitment = aliceDepositUtxo.getCommitment()
    const index = tree.indexOf(toFixedHex(commitment)) // it's the same as merklePath and merklePathIndexes and index in the tree
    aliceDepositUtxo.index = index
    const nullifier = aliceDepositUtxo.getNullifier()

    // commitment = hash(amount, pubKey, blinding)
    // nullifier = hash(commitment, merklePath, sign(merklePath, privKey))
    const dataForVerifier = {
      commitment: {
        amount: aliceDepositUtxo.amount,
        pubkey: aliceDepositUtxo.keypair.pubkey,
        blinding: aliceDepositUtxo.blinding,
      },
      nullifier: {
        commitment,
        merklePath: index,
        signature: aliceDepositUtxo.keypair.sign(commitment, index),
      },
    }

    // generateReport(dataForVerifier) -> compliance report
    // on the verifier side we compute commitment and nullifier and then check them onchain
    const commitmentV = poseidonHash([...Object.values(dataForVerifier.commitment)])
    const nullifierV = poseidonHash([
      commitmentV,
      dataForVerifier.nullifier.merklePath,
      dataForVerifier.nullifier.signature,
    ])

    expect(commitmentV).to.be.equal(commitment)
    expect(nullifierV).to.be.equal(nullifier)
    expect(await tornadoPool.nullifierHashes(nullifierV)).to.be.equal(true)
    // expect commitmentV present onchain (it will be in NewCommitment events)

    // in report we can see the tx with NewCommitment event (this is how alice got money)
    // and the tx with NewNullifier event is where alice spent the UTXO
  })
})
