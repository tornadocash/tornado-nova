/* global ethers */
const { expect, should } = require('chai')
should()

const { poseidonHash2, toFixedHex, takeSnapshot, revertSnapshot } = require('../src/utils')

const MERKLE_TREE_HEIGHT = 5
const MerkleTree = require('fixed-merkle-tree')

const { deposit, transact, withdraw, merge } = require('../src/index')
const Keypair = require('../src/keypair')

describe.only('Keypair', () => {
  it('should work', () => {
    const blinding = 3
    const amount = 5
    const keypair = new Keypair()

    const cyphertext = keypair.encrypt({ blinding, amount})
    console.log(cyphertext)
    const result = keypair.decrypt(cyphertext)
    console.log(result, result.blinding.toString())
    expect(result.blinding).to.be.equal(blinding)
    expect(result.amount).to.be.equal(amount)
  })
})

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

  it('should deposit, transact and withdraw', async function () {
    const utxo1 = await deposit({ tornadoPool })
    const utxo2 = await transact({ tornadoPool, utxo: utxo1 })

    const recipient = '0xc2Ba33d4c0d2A92fb4f1a07C273c5d21E688Eb48'
    await withdraw({ tornadoPool, utxo: utxo2, recipient })

    let bal = await ethers.provider.getBalance(recipient)
    expect(bal).to.be.gt(0)
  })

  it('should work with 16 inputs', async function () {
    const utxo1 = await merge({tornadoPool})
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId)
    snapshotId = await takeSnapshot()
  })
})
