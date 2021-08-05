/* global ethers */
const { expect, should } = require('chai')
should()

const { poseidonHash2, toFixedHex, takeSnapshot, revertSnapshot } = require('../src/utils')
const Utxo = require('../src/utxo')

const MERKLE_TREE_HEIGHT = 5
const MerkleTree = require('fixed-merkle-tree')

const { transaction, registerAndTransact } = require('../src/index')
const { Keypair } = require('../src/keypair')

describe('TornadoPool', () => {
  let snapshotId, tornadoPool, sender, gov, proxy, messenger

  /* prettier-ignore */
  before(async function () {
    ;[sender, gov] = await ethers.getSigners()

    const Verifier2 = await ethers.getContractFactory('Verifier2')
    const verifier2 = await Verifier2.deploy()
    await verifier2.deployed()

    const Verifier16 = await ethers.getContractFactory('Verifier16')
    const verifier16 = await Verifier16.deploy()
    await verifier16.deployed()

    const tree = new MerkleTree(MERKLE_TREE_HEIGHT, [], { hashFunction: poseidonHash2 })
    const root = await tree.root()

    const Pool = await ethers.getContractFactory('TornadoPool')
    const tornadoPoolImpl = await Pool.deploy(verifier2.address, verifier16.address)

    const OVM_Messenger = await ethers.getContractFactory('MockOVM_CrossDomainMessenger')
    messenger = await OVM_Messenger.deploy(gov.address)
    await messenger.deployed()

    const CrossChainUpgradeableProxy = await ethers.getContractFactory('CrossChainUpgradeableProxy')
    proxy = await CrossChainUpgradeableProxy.deploy(tornadoPoolImpl.address, gov.address, [], messenger.address)
    await proxy.deployed()

    tornadoPool = await Pool.attach(proxy.address)

    await tornadoPool.initialize(toFixedHex(root))

    snapshotId = await takeSnapshot()
  })
  describe('Upgradeability tests', () => {
    it('admin should be gov', async () => {
      const { data } = await proxy.populateTransaction.admin()
      const { result } = await messenger.callStatic.execute(proxy.address, data)
      expect('0x' + result.slice(26)).to.be.equal(gov.address.toLowerCase())
    })

    it('non admin cannot call', async () => {
      await proxy
        .admin()
        .should.be.revertedWith(
          "Transaction reverted: function selector was not recognized and there's no fallback function",
        )
    })
  })

  it('encrypt -> decrypt should work', () => {
    const data = Buffer.from([0xff, 0xaa, 0x00, 0x01])
    const keypair = new Keypair()

    const ciphertext = keypair.encrypt(data)
    const result = keypair.decrypt(ciphertext)
    expect(result).to.be.deep.equal(data)
  })

  it('should register and deposit', async function () {
    // Alice deposits into tornado pool
    const aliceDepositAmount = 1e7
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })

    const backupAccount = new Keypair()

    const bufferPrivateKey = Buffer.from(aliceDepositUtxo.keypair.privkey)
    const packedPrivateKeyData = backupAccount.encrypt(bufferPrivateKey)

    tornadoPool = tornadoPool.connect(sender)
    await registerAndTransact({
      tornadoPool,
      packedPrivateKeyData,
      outputs: [aliceDepositUtxo],
      poolAddress: aliceDepositUtxo.keypair.address(),
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

    const accountFilter = tornadoPool.filters.EncryptedAccount(sender.address)
    const accountFromBlock = await ethers.provider.getBlock()
    const accountEvents = await tornadoPool.queryFilter(accountFilter, accountFromBlock.number)

    const [accountEvent] = accountEvents.sort((a, b) => a.blockNumber - b.blockNumber).slice(-1)

    const privateKey = backupAccount.decrypt(accountEvent.args.account)

    expect(bufferPrivateKey.toString('hex')).to.be.equal(privateKey.toString('hex'))
  })

  it('should deposit, transact and withdraw', async function () {
    // Alice deposits into tornado pool
    const aliceDepositAmount = 1e7
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })
    await transaction({ tornadoPool, outputs: [aliceDepositUtxo] })

    // Bob gives Alice address to send some eth inside the shielded pool
    const bobKeypair = new Keypair() // contains private and public keys
    const bobAddress = bobKeypair.address() // contains only public key

    // Alice sends some funds to Bob
    const bobSendAmount = 3e6
    const bobSendUtxo = new Utxo({ amount: bobSendAmount, keypair: Keypair.fromString(bobAddress) })
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount - bobSendAmount,
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
    const bobWithdrawAmount = 2e6
    const bobEthAddress = '0xDeaD00000000000000000000000000000000BEEf'
    const bobChangeUtxo = new Utxo({ amount: bobSendAmount - bobWithdrawAmount, keypair: bobKeypair })
    await transaction({
      tornadoPool,
      inputs: [bobReceiveUtxo],
      outputs: [bobChangeUtxo],
      recipient: bobEthAddress,
    })

    const bobBalance = await ethers.provider.getBalance(bobEthAddress)
    expect(bobBalance).to.be.equal(bobWithdrawAmount)
  })

  it('should work with 16 inputs', async function () {
    await transaction({ tornadoPool, inputs: [new Utxo(), new Utxo(), new Utxo()] })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId)
    snapshotId = await takeSnapshot()
  })
})
