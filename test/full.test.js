/* global ethers */
const { expect, should } = require('chai')
should()
const { BigNumber } = ethers

const {
  poseidonHash2,
  toFixedHex,
  takeSnapshot,
  revertSnapshot,
  packEncryptedMessage,
  unpackEncryptedMessage,
} = require('../src/utils')
const Utxo = require('../src/utxo')

const MERKLE_TREE_HEIGHT = 5
const MerkleTree = require('fixed-merkle-tree')

const { deposit, transact, withdraw, merge } = require('../src/index')
const Keypair = require('../src/keypair')

describe('TornadoPool', () => {
  let snapshotId, tornadoPool

  /* prettier-ignore */
  before(async function () {
    const Verifier2 = await ethers.getContractFactory('Verifier2')
    const verifier2 = await Verifier2.deploy()
    await verifier2.deployed()

    const Verifier16 = await ethers.getContractFactory('Verifier16')
    const verifier16 = await Verifier16.deploy()
    await verifier16.deployed()

    const tree = new MerkleTree(MERKLE_TREE_HEIGHT, [], { hashFunction: poseidonHash2 })
    const root = await tree.root()

    const Pool = await ethers.getContractFactory('TornadoPool')
    tornadoPool = await Pool.deploy(verifier2.address, verifier16.address, toFixedHex(root))

    snapshotId = await takeSnapshot()
  })

  it('encryp -> pack -> unpack -> decrypt should work', () => {
    const blinding = 3
    const amount = 5
    const keypair = new Keypair()

    const cyphertext = keypair.encrypt({ blinding, amount })

    const packedMessage = packEncryptedMessage(cyphertext)

    const unpackedMessage = unpackEncryptedMessage(packedMessage)

    const result = keypair.decrypt(unpackedMessage)

    expect(result.blinding).to.be.equal(blinding)
    expect(result.amount).to.be.equal(amount)
  })

  it('should deposit, transact and withdraw', async function () {
    /// deposit phase
    // Alice deposits into tornado pool
    const amount = BigNumber.from('10000000')
    const alicePrivateKey = ethers.Wallet.createRandom().privateKey // the private key we use for snarks and encryption, not for transactions
    const aliceKeypair = new Keypair(alicePrivateKey)

    const depositInput = new Utxo({ amount, keypair: aliceKeypair })
    await deposit({ tornadoPool, utxo: depositInput })

    // getting account data from chain to verify that Alice has an Input to spend now
    const filter = tornadoPool.filters.NewCommitment()
    let events = await tornadoPool.queryFilter(filter)
    let unpackedMessage = unpackEncryptedMessage(events[0].args.encryptedOutput)
    let decryptedMessage = aliceKeypair.decrypt(unpackedMessage)
    let aliceInputIndex = events[0].args.index
    expect(decryptedMessage.amount).to.be.equal(amount)
    expect(decryptedMessage.blinding).to.be.equal(depositInput.blinding)

    /// transact phase.
    // Bob gives Alice address to send some eth inside pool
    const bobPrivateKey = ethers.Wallet.createRandom().privateKey
    const bobKeypair = new Keypair(bobPrivateKey)
    const bobAddress = bobKeypair.address()

    // but alice does not have Bob's privkey so let's build keypair without it
    const bobKeypairForEncryption = Keypair.fromString(bobAddress)

    // let's build input for the shielded transaction
    const aliceInput = new Utxo({
      amount,
      blinding: depositInput.blinding,
      index: aliceInputIndex,
      keypair: aliceKeypair,
    })
    const bobInput = new Utxo({ amount, keypair: bobKeypairForEncryption })

    await transact({ tornadoPool, input: aliceInput, output: bobInput })

    // getting account data from chain to verify that Bob has an Input to spend now
    const fromBlock = await ethers.provider.getBlock()
    events = await tornadoPool.queryFilter(filter, fromBlock.number)
    const bobInputIndex = events[0].args.index
    unpackedMessage = unpackEncryptedMessage(events[0].args.encryptedOutput)
    decryptedMessage = bobKeypair.decrypt(unpackedMessage)
    expect(decryptedMessage.amount).to.be.equal(amount)
    expect(decryptedMessage.blinding).to.be.equal(bobInput.blinding)

    /// withdraw phase
    // now Bob wants to exit the pool using a half of its funds
    const bobInputForWithdraw = new Utxo({
      amount,
      blinding: bobInput.blinding,
      index: bobInputIndex,
      keypair: bobKeypair,
    })
    const bobChange = new Utxo({ amount: amount.div(2), keypair: bobKeypair })
    const recipient = '0xc2Ba33d4c0d2A92fb4f1a07C273c5d21E688Eb48'
    await withdraw({ tornadoPool, input: bobInputForWithdraw, change: bobChange, recipient })

    const bal = await ethers.provider.getBalance(recipient)
    expect(bal).to.be.gt(0)
  })

  it('should work with 16 inputs', async function () {
    const utxo1 = await merge({ tornadoPool })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId)
    snapshotId = await takeSnapshot()
  })
})
