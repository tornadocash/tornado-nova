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

const { transaction } = require('../src/index')
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

  it('encrypt -> decrypt should work', () => {
    const data = Buffer.from([0xff, 0xaa, 0x00, 0x01])
    const keypair = new Keypair()

    const ciphertext = keypair.encrypt(data)
    const result = keypair.decrypt(ciphertext)
    expect(result).to.be.deep.equal(data)
  })

  it('should deposit, transact and withdraw', async function () {
    // Alice deposits into tornado pool
    const aliceDepositAmount = 1e7
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })
    await transaction({ tornadoPool, outputs: [aliceDepositUtxo] })

    // Bob gives Alice address to send some eth inside the shielded pool
    const bobKeypair = new Keypair()
    const bobAddress = bobKeypair.address()

    // Alice sends some funds to Bob
    const bobSendAmount = 3e6
    const bobSendUtxo = new Utxo({ amount: bobSendAmount, keypair: Keypair.fromString(bobAddress) })
    const aliceChangeUtxo = new Utxo({ amount: aliceDepositAmount - bobSendAmount, keypair: aliceDepositUtxo.keypair })
    await transaction({ tornadoPool, inputs: [aliceDepositUtxo], outputs: [bobSendUtxo, aliceChangeUtxo] })

    // Bob parses chain to detect incoming funds
    const filter = tornadoPool.filters.NewCommitment()
    const fromBlock = await ethers.provider.getBlock()
    const events = await tornadoPool.queryFilter(filter, fromBlock.number)
    const bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args.encryptedOutput, events[0].args.index)
    expect(bobReceiveUtxo.amount).to.be.equal(bobSendAmount)

    // Bob withdraws part of his funds from the shielded pool
    const bobWithdrawAmount = 2e6
    const bobEthAddress = '0xDeaD00000000000000000000000000000000BEEf'
    const bobChangeUtxo = new Utxo({ amount: bobSendAmount - bobWithdrawAmount, keypair: bobKeypair })
    await transaction({ tornadoPool, inputs: [bobReceiveUtxo], outputs: [bobChangeUtxo], recipient: bobEthAddress })

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
