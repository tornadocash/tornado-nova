const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')

const { poseidonHash2, toFixedHex } = require('../src/utils')

const MERKLE_TREE_HEIGHT = 5
const MerkleTree = require('fixed-merkle-tree')

describe('MerkleTreeWithHistory', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  function getNewTree() {
    return new MerkleTree(MERKLE_TREE_HEIGHT, [], { hashFunction: poseidonHash2 })
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const hasher = await deploy('Hasher')
    const merkleTreeWithHistory = await deploy(
      'MerkleTreeWithHistoryMock',
      MERKLE_TREE_HEIGHT,
      hasher.address,
    )
    await merkleTreeWithHistory.initialize()
    return { hasher, merkleTreeWithHistory }
  }

  // it('should return cloned tree in fixture', async () => {
  //   const { tree: tree1 } = await loadFixture(fixture)
  //   tree1.insert(1)
  //   const { tree: tree2 } = await loadFixture(fixture)
  //   expect(tree1.root()).to.not.equal(tree2.root())
  // })

  describe('#constructor', () => {
    it('should correctly hash 2 leaves', async () => {
      const { merkleTreeWithHistory } = await loadFixture(fixture)
      //console.log(hasher)
      const hash0 = await merkleTreeWithHistory.hashLeftRight(toFixedHex(123), toFixedHex(456))
      // const hash1 = await hasher.poseidon([123, 456])
      const hash2 = poseidonHash2(123, 456)
      expect(hash0).to.equal(hash2)
    })

    it('should initialize', async () => {
      const { merkleTreeWithHistory } = await loadFixture(fixture)
      const zeroValue = await merkleTreeWithHistory.ZERO_VALUE()
      const firstSubtree = await merkleTreeWithHistory.filledSubtrees(0)
      const firstZero = await merkleTreeWithHistory.zeros(0)
      expect(firstSubtree).to.be.equal(zeroValue)
      expect(firstZero).to.be.equal(zeroValue)
    })

    it('should have correct merkle root', async () => {
      const { merkleTreeWithHistory } = await loadFixture(fixture)
      const tree = getNewTree()
      const contractRoot = await merkleTreeWithHistory.getLastRoot()
      expect(tree.root()).to.equal(contractRoot)
    })
  })

  describe('#insert', () => {
    it('should insert', async () => {
      const { merkleTreeWithHistory } = await loadFixture(fixture)
      const tree = getNewTree()
      merkleTreeWithHistory.insert(toFixedHex(123), toFixedHex(456))
      tree.bulkInsert([123, 456])
      expect(tree.root()).to.be.be.equal(await merkleTreeWithHistory.getLastRoot())

      merkleTreeWithHistory.insert(toFixedHex(678), toFixedHex(876))
      tree.bulkInsert([678, 876])
      expect(tree.root()).to.be.be.equal(await merkleTreeWithHistory.getLastRoot())
    })

    it('hasher gas', async () => {
      const { merkleTreeWithHistory } = await loadFixture(fixture)
      const gas = await merkleTreeWithHistory.estimateGas.hashLeftRight(toFixedHex(123), toFixedHex(456))
      console.log('hasher gas', gas - 21000)
    })
  })

  describe('#isKnownRoot', () => {
    async function fixtureFilled() {
      const { merkleTreeWithHistory, hasher } = await loadFixture(fixture)
      await merkleTreeWithHistory.insert(toFixedHex(123), toFixedHex(456))
      return { merkleTreeWithHistory, hasher }
    }

    it('should return last root', async () => {
      const { merkleTreeWithHistory } = await fixtureFilled(fixture)
      const tree = getNewTree()
      tree.bulkInsert([123, 456])
      expect(await merkleTreeWithHistory.isKnownRoot(tree.root())).to.equal(true)
    })

    it('should return older root', async () => {
      const { merkleTreeWithHistory } = await fixtureFilled(fixture)
      const tree = getNewTree()
      tree.bulkInsert([123, 456])
      await merkleTreeWithHistory.insert(toFixedHex(234), toFixedHex(432))
      expect(await merkleTreeWithHistory.isKnownRoot(tree.root())).to.equal(true)
    })

    it('should fail on unknown root', async () => {
      const { merkleTreeWithHistory } = await fixtureFilled(fixture)
      const tree = getNewTree()
      tree.bulkInsert([456, 654])
      expect(await merkleTreeWithHistory.isKnownRoot(tree.root())).to.equal(false)
    })

    it('should not return uninitialized roots', async () => {
      const { merkleTreeWithHistory } = await fixtureFilled(fixture)
      expect(await merkleTreeWithHistory.isKnownRoot(toFixedHex(0))).to.equal(false)
    })
  })
})
