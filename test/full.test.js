const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers
const { BigNumber } = require('@ethersproject/bignumber')

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')
const { getWithdrawalWorkerBytecode } = require('../src/withdrawWorker')
const config = require('../config')
const { generate } = require('../src/0_generateAddresses')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
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
    require('../scripts/compileHasher3')
    const [sender, gov, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')
    const hasher3 = await deploy('Hasher3')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const l1Token = await deploy('WETH', 'Wrapped ETH', 'WETH')
    await l1Token.deposit({ value: utils.parseEther('3') })

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    // deploy L1Unwrapper with CREATE2
    const singletonFactory = await ethers.getContractAt('SingletonFactory', config.singletonFactory)

    let customConfig = Object.assign({}, config)
    customConfig.omniBridge = omniBridge.address
    customConfig.weth = l1Token.address
    customConfig.multisig = multisig.address
    const contracts = await generate(customConfig)
    await singletonFactory.deploy(contracts.unwrapperContract.bytecode, config.salt)
    const l1Unwrapper = await ethers.getContractAt('L1Unwrapper', contracts.unwrapperContract.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      hasher3.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(MAXIMUM_DEPOSIT_AMOUNT)
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

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig, l1Unwrapper, sender, l1Token }
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
      const { tornadoPool, multisig } = await loadFixture(fixture)
      const newDepositLimit = utils.parseEther('1337')

      await tornadoPool.connect(multisig).configureLimits(newDepositLimit)

      expect(await tornadoPool.maximumDepositAmount()).to.be.equal(newDepositLimit)
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

  it('should public deposit', async function () {
    let { tornadoPool, token } = await loadFixture(fixture)
    const sender = (await ethers.getSigners())[0]
    tornadoPool = tornadoPool.connect(sender)

    // Alice deposits into tornado pool
    const aliceDepositAmount = utils.parseEther('0.1')
    const aliceKeypair = new Keypair()
    const alicePubkey = aliceKeypair.address().slice(0, 66)

    await expect(() => tornadoPool.publicDeposit(alicePubkey, aliceDepositAmount)).to.changeTokenBalances(
      token,
      [sender, tornadoPool],
      [BigNumber.from(0).sub(aliceDepositAmount), aliceDepositAmount],
    )

    const filter = tornadoPool.filters.NewCommitment()
    let fromBlock = await ethers.provider.getBlock()
    let events = await tornadoPool.queryFilter(filter, fromBlock.number)

    const packedOutput = utils.solidityPack(
      ['string', 'uint256', 'bytes32'],
      ['abi', aliceDepositAmount, alicePubkey],
    )
    expect(events[0].args.encryptedOutput).to.be.equal(packedOutput)

    const aliceDepositUtxo = new Utxo({
      amount: aliceDepositAmount,
      keypair: aliceKeypair,
      blinding: 0,
      index: 0,
    })

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
    fromBlock = await ethers.provider.getBlock()
    events = await tornadoPool.queryFilter(filter, fromBlock.number)
    let bobReceiveUtxo
    try {
      bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args.encryptedOutput, events[0].args.index)
    } catch (e) {
      // we try to decrypt another output here because it shuffles outputs before sending to blockchain
      bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[1].args.encryptedOutput, events[1].args.index)
    }
    expect(bobReceiveUtxo.amount).to.be.equal(bobSendAmount)
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

  it('should withdraw with L1 fee', async function () {
    const { tornadoPool, token, omniBridge, l1Unwrapper, sender, l1Token } = await loadFixture(fixture)
    const aliceKeypair = new Keypair() // contains private and public keys

    // regular L1 deposit -------------------------------------------
    const aliceDepositAmount = utils.parseEther('0.07')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount, keypair: aliceKeypair })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })

    let onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    })

    let onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      aliceDepositUtxo.amount,
      onTokenBridgedData,
    )
    // emulating bridge. first it sends tokens to omnibridge mock then it sends to the pool
    await token.transfer(omniBridge.address, aliceDepositAmount)
    let transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // call onTokenBridgedTx
    ])

    // withdrawal with L1 fee ---------------------------------------
    // withdraws a part of his funds from the shielded pool
    const aliceWithdrawAmount = utils.parseEther('0.06')
    const l1Fee = utils.parseEther('0.01')
    // sum of desired withdraw amount and L1 fee are stored in extAmount
    const extAmount = aliceWithdrawAmount.add(l1Fee)
    const recipient = '0xDeaD00000000000000000000000000000000BEEf'
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(extAmount),
      keypair: aliceKeypair,
    })
    await transaction({
      tornadoPool,
      inputs: [aliceDepositUtxo],
      outputs: [aliceChangeUtxo],
      recipient: recipient,
      isL1Withdrawal: true,
      l1Fee: l1Fee,
    })

    const filter = omniBridge.filters.OnTokenTransfer()
    const fromBlock = await ethers.provider.getBlock()
    const events = await omniBridge.queryFilter(filter, fromBlock.number)
    onTokenBridgedData = events[0].args.data
    const hexL1Fee = '0x' + events[0].args.data.toString().slice(66)
    expect(ethers.BigNumber.from(hexL1Fee)).to.be.equal(l1Fee)

    const recipientBalance = await token.balanceOf(recipient)
    expect(recipientBalance).to.be.equal(0)
    const omniBridgeBalance = await token.balanceOf(omniBridge.address)
    expect(omniBridgeBalance).to.be.equal(extAmount)

    // L1 transactions:
    onTokenBridgedTx = await l1Unwrapper.populateTransaction.onTokenBridged(
      l1Token.address,
      extAmount,
      onTokenBridgedData,
    )
    // emulating bridge. first it sends tokens to omniBridge mock then it sends to the recipient
    await l1Token.transfer(omniBridge.address, extAmount)
    transferTx = await l1Token.populateTransaction.transfer(l1Unwrapper.address, extAmount)

    const senderBalanceBefore = await ethers.provider.getBalance(sender.address)

    let tx = await omniBridge.execute([
      { who: l1Token.address, callData: transferTx.data }, // send tokens to L1Unwrapper
      { who: l1Unwrapper.address, callData: onTokenBridgedTx.data }, // call onTokenBridged on L1Unwrapper
    ])

    let receipt = await tx.wait()
    let txFee = receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice)
    const senderBalanceAfter = await ethers.provider.getBalance(sender.address)
    expect(senderBalanceAfter).to.be.equal(senderBalanceBefore.sub(txFee).add(l1Fee))
    expect(await ethers.provider.getBalance(recipient)).to.be.equal(aliceWithdrawAmount)
  })

  it('should withdraw with call', async function () {
    const { tornadoPool, token } = await loadFixture(fixture)
    const aliceKeypair = new Keypair() // contains private and public keys

    // regular L1 deposit -------------------------------------------

    // Alice deposits into tornado pool
    const aliceDepositAmount = utils.parseEther('0.07')
    let aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })
    await transaction({ tornadoPool, outputs: [aliceDepositUtxo] })

    // withdrawal with call -----------------------------------------
    // withdraws a part of his funds from the shielded pool
    const aliceWithdrawAmount = utils.parseEther('0.06')
    const recipient = (await ethers.getSigners())[1]
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(aliceWithdrawAmount),
      keypair: aliceKeypair,
    })
    const transferTx = await token.populateTransaction.transfer(recipient.address, aliceWithdrawAmount)
    const approveTx = await token.populateTransaction.approve(recipient.address, aliceWithdrawAmount)

    const withdrawalBytecode = getWithdrawalWorkerBytecode(
      token.address,
      [token.address, token.address],
      [transferTx.data, approveTx.data],
    )

    await expect(() =>
      transaction({
        tornadoPool,
        inputs: [aliceDepositUtxo],
        outputs: [aliceChangeUtxo],
        recipient: ethers.constants.AddressZero,
        withdrawalBytecode: withdrawalBytecode,
      }),
    ).to.changeTokenBalances(
      token,
      [tornadoPool, recipient],
      [BigNumber.from(0).sub(aliceWithdrawAmount), aliceWithdrawAmount],
    )

    const filter = token.filters.Approval()
    const fromBlock = await ethers.provider.getBlock()
    const events = await token.queryFilter(filter, fromBlock.number)
    expect(events[0].args.spender).to.be.equal(recipient.address)
    expect(events[0].args.value).to.be.equal(aliceWithdrawAmount)
  })

  it('should withdraw with call and stuck tokens', async function () {
    const { tornadoPool, token } = await loadFixture(fixture)
    const aliceKeypair = new Keypair() // contains private and public keys

    // regular L1 deposit -------------------------------------------

    // Alice deposits into tornado pool
    const aliceDepositAmount = utils.parseEther('0.07')
    let aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })
    await transaction({ tornadoPool, outputs: [aliceDepositUtxo] })

    // withdrawal with call -----------------------------------------
    // withdraws a part of his funds from the shielded pool
    const aliceWithdrawAmount = utils.parseEther('0.06')
    const aliceTransferAmount = utils.parseEther('0.05')
    const recipient = (await ethers.getSigners())[1]
    const changeReceiver = (await ethers.getSigners())[2]
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(aliceWithdrawAmount),
      keypair: aliceKeypair,
    })
    const transferTx = await token.populateTransaction.transfer(recipient.address, aliceTransferAmount)
    const approveTx = await token.populateTransaction.approve(recipient.address, aliceTransferAmount)

    // stuck tokens - revert
    const withdrawalBytecode = getWithdrawalWorkerBytecode(
      token.address,
      [token.address, token.address],
      [transferTx.data, approveTx.data],
    )

    await expect(
      transaction({
        tornadoPool,
        inputs: [aliceDepositUtxo],
        outputs: [aliceChangeUtxo],
        recipient: ethers.constants.AddressZero,
        withdrawalBytecode: withdrawalBytecode,
      }),
    ).to.be.revertedWith('Create2: Failed on deploy') // Stuck tokens on withdrawal worker

    // use contract with stuck tokens check
    const WithdrawalWorkerStuckCheck = await ethers.getContractFactory('WithdrawalWorkerStuckCheck')
    const deployTx = await WithdrawalWorkerStuckCheck.getDeployTransaction(
      token.address,
      changeReceiver.address,
      [token.address, token.address],
      [transferTx.data, approveTx.data],
    )

    await expect(() =>
      transaction({
        tornadoPool,
        inputs: [aliceDepositUtxo],
        outputs: [aliceChangeUtxo],
        recipient: ethers.constants.AddressZero,
        withdrawalBytecode: deployTx.data,
      }),
    ).to.changeTokenBalances(
      token,
      [tornadoPool, recipient, changeReceiver],
      [
        BigNumber.from(0).sub(aliceWithdrawAmount),
        aliceTransferAmount,
        aliceWithdrawAmount.sub(aliceTransferAmount),
      ],
    )

    const filter = token.filters.Approval()
    const fromBlock = await ethers.provider.getBlock()
    const events = await token.queryFilter(filter, fromBlock.number)
    expect(events[0].args.spender).to.be.equal(recipient.address)
    expect(events[0].args.value).to.be.equal(aliceTransferAmount)
  })

  it('should withdraw with public deposit', async function () {
    const { tornadoPool, token, sender } = await loadFixture(fixture)
    const aliceKeypair = new Keypair() // contains private and public keys
    const alicePubkey = aliceKeypair.address().slice(0, 66)

    // regular L1 deposit -----------------------------------------------------
    // ------------------------------------------------------------------------

    // Alice deposits into tornado pool
    const aliceDepositAmount = utils.parseEther('0.07')
    let aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })
    await transaction({ tornadoPool, outputs: [aliceDepositUtxo] })

    // withdrawal with call ---------------------------------------------------
    // ------------------------------------------------------------------------

    // withdraws a part of his funds from the shielded pool
    const aliceWithdrawAmount = utils.parseEther('0.06')
    const publicDepositAmount = utils.parseEther('0.04')
    const realWithdrawAmount = utils.parseEther('0.02')
    const recipient = (await ethers.getSigners())[1]
    let aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(aliceWithdrawAmount),
      keypair: aliceKeypair,
    })
    const transferTx = await token.populateTransaction.transfer(recipient.address, realWithdrawAmount)
    const approveTx = await token.populateTransaction.approve(tornadoPool.address, publicDepositAmount)
    const publicDepoTx = await tornadoPool.populateTransaction.publicDeposit(alicePubkey, publicDepositAmount)

    const withdrawalBytecode = getWithdrawalWorkerBytecode(
      token.address,
      [token.address, token.address, tornadoPool.address],
      [transferTx.data, approveTx.data, publicDepoTx.data],
    )

    await expect(() =>
      transaction({
        tornadoPool,
        inputs: [aliceDepositUtxo],
        outputs: [aliceChangeUtxo],
        recipient: ethers.constants.AddressZero,
        withdrawalBytecode: withdrawalBytecode,
      }),
    ).to.changeTokenBalances(
      token,
      [tornadoPool, recipient],
      [BigNumber.from(0).sub(realWithdrawAmount), realWithdrawAmount],
    )

    let filter = token.filters.Approval()
    let fromBlock = await ethers.provider.getBlock()
    let events = await token.queryFilter(filter, fromBlock.number)
    expect(events[0].args.spender).to.be.equal(tornadoPool.address)
    expect(events[0].args.value).to.be.equal(publicDepositAmount)

    // check public depo and spend it -----------------------------------------
    // ------------------------------------------------------------------------

    filter = tornadoPool.filters.NewCommitment()
    events = await tornadoPool.queryFilter(filter, fromBlock.number)

    const packedOutput = utils.solidityPack(
      ['string', 'uint256', 'bytes32'],
      ['abi', publicDepositAmount, alicePubkey],
    )
    expect(events[0].args.encryptedOutput).to.be.equal(packedOutput)

    aliceDepositUtxo = new Utxo({
      amount: publicDepositAmount,
      keypair: aliceKeypair,
      blinding: 0,
      index: 0,
    })

    // Bob gives Alice address to send some eth inside the shielded pool
    const bobKeypair = new Keypair() // contains private and public keys
    const bobAddress = bobKeypair.address() // contains only public key

    // Alice sends some funds to Bob
    const bobSendAmount = utils.parseEther('0.01')
    const bobSendUtxo = new Utxo({ amount: bobSendAmount, keypair: Keypair.fromString(bobAddress) })
    aliceChangeUtxo = new Utxo({
      amount: publicDepositAmount.sub(bobSendAmount),
      keypair: aliceDepositUtxo.keypair,
    })

    await expect(() =>
      transaction({ tornadoPool, inputs: [aliceDepositUtxo], outputs: [bobSendUtxo, aliceChangeUtxo] }),
    ).to.changeTokenBalances(token, [tornadoPool, sender], [0, 0])

    // Bob parses chain to detect incoming funds
    fromBlock = await ethers.provider.getBlock()
    events = await tornadoPool.queryFilter(filter, fromBlock.number)
    let bobReceiveUtxo
    try {
      bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args.encryptedOutput, events[0].args.index)
    } catch (e) {
      // we try to decrypt another output here because it shuffles outputs before sending to blockchain
      bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[1].args.encryptedOutput, events[1].args.index)
    }
    expect(bobReceiveUtxo.amount).to.be.equal(bobSendAmount)
  })

  it('should set L1FeeReceiver on L1Unwrapper contract', async function () {
    const { tornadoPool, token, omniBridge, l1Unwrapper, sender, l1Token, multisig } = await loadFixture(
      fixture,
    )

    // check init l1FeeReceiver
    expect(await l1Unwrapper.l1FeeReceiver()).to.be.equal(ethers.constants.AddressZero)

    // should not set from not multisig

    await expect(l1Unwrapper.connect(sender).setL1FeeReceiver(multisig.address)).to.be.reverted

    expect(await l1Unwrapper.l1FeeReceiver()).to.be.equal(ethers.constants.AddressZero)

    // should set from multisig
    await l1Unwrapper.connect(multisig).setL1FeeReceiver(multisig.address)

    expect(await l1Unwrapper.l1FeeReceiver()).to.be.equal(multisig.address)

    // ------------------------------------------------------------------------
    // check withdraw with L1 fee ---------------------------------------------

    const aliceKeypair = new Keypair() // contains private and public keys

    // regular L1 deposit -------------------------------------------
    const aliceDepositAmount = utils.parseEther('0.07')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount, keypair: aliceKeypair })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })

    let onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    })

    let onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      aliceDepositUtxo.amount,
      onTokenBridgedData,
    )
    // emulating bridge. first it sends tokens to omnibridge mock then it sends to the pool
    await token.transfer(omniBridge.address, aliceDepositAmount)
    let transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // call onTokenBridgedTx
    ])

    // withdrawal with L1 fee ---------------------------------------
    // withdraws a part of his funds from the shielded pool
    const aliceWithdrawAmount = utils.parseEther('0.06')
    const l1Fee = utils.parseEther('0.01')
    // sum of desired withdraw amount and L1 fee are stored in extAmount
    const extAmount = aliceWithdrawAmount.add(l1Fee)
    const recipient = '0xDeaD00000000000000000000000000000000BEEf'
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(extAmount),
      keypair: aliceKeypair,
    })
    await transaction({
      tornadoPool,
      inputs: [aliceDepositUtxo],
      outputs: [aliceChangeUtxo],
      recipient: recipient,
      isL1Withdrawal: true,
      l1Fee: l1Fee,
    })

    const filter = omniBridge.filters.OnTokenTransfer()
    const fromBlock = await ethers.provider.getBlock()
    const events = await omniBridge.queryFilter(filter, fromBlock.number)
    onTokenBridgedData = events[0].args.data
    const hexL1Fee = '0x' + events[0].args.data.toString().slice(66)
    expect(ethers.BigNumber.from(hexL1Fee)).to.be.equal(l1Fee)

    const recipientBalance = await token.balanceOf(recipient)
    expect(recipientBalance).to.be.equal(0)
    const omniBridgeBalance = await token.balanceOf(omniBridge.address)
    expect(omniBridgeBalance).to.be.equal(extAmount)

    // L1 transactions:
    onTokenBridgedTx = await l1Unwrapper.populateTransaction.onTokenBridged(
      l1Token.address,
      extAmount,
      onTokenBridgedData,
    )
    // emulating bridge. first it sends tokens to omniBridge mock then it sends to the recipient
    await l1Token.transfer(omniBridge.address, extAmount)
    transferTx = await l1Token.populateTransaction.transfer(l1Unwrapper.address, extAmount)

    const senderBalanceBefore = await ethers.provider.getBalance(sender.address)
    const multisigBalanceBefore = await ethers.provider.getBalance(multisig.address)

    let tx = await omniBridge.execute([
      { who: l1Token.address, callData: transferTx.data }, // send tokens to L1Unwrapper
      { who: l1Unwrapper.address, callData: onTokenBridgedTx.data }, // call onTokenBridged on L1Unwrapper
    ])

    let receipt = await tx.wait()
    let txFee = receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice)
    expect(await ethers.provider.getBalance(sender.address)).to.be.equal(senderBalanceBefore.sub(txFee))
    expect(await ethers.provider.getBalance(multisig.address)).to.be.equal(multisigBalanceBefore.add(l1Fee))
    expect(await ethers.provider.getBalance(recipient)).to.be.equal(aliceWithdrawAmount)
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
