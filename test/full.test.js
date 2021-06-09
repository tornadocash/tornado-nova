/* global ethers */
const { expect, should } = require('chai')
should()

const { poseidonHash2, toFixedHex, takeSnapshot, revertSnapshot } = require('../src/utils')

const MERKLE_TREE_HEIGHT = 5
const MerkleTree = require('fixed-merkle-tree')

const { deposit, transact, withdraw } = require('../src/index')

describe('TornadoPool', () => {
  let snapshotId, tornadoPool

  /* prettier-ignore */
  before(async function () {
    const Verifier = await ethers.getContractFactory('Verifier')
    const verifier = await Verifier.deploy()
    await verifier.deployed()

    const tree = new MerkleTree(MERKLE_TREE_HEIGHT, [], { hashFunction: poseidonHash2 })
    const root = await tree.root()

    const Pool = await ethers.getContractFactory('TornadoPool')
    tornadoPool = await Pool.deploy(verifier.address, toFixedHex(root))

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

  afterEach(async () => {
    await revertSnapshot(snapshotId)
    snapshotId = await takeSnapshot()
  })
})
