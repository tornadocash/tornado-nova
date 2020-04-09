/* global artifacts */
const Verifier = artifacts.require('Verifier')
const TornadoPool = artifacts.require('TornadoPool')
const MERKLE_TREE_HEIGHT = 5
const MerkleTree = require('../lib/merkleTree')
const { bigInt } = require('snarkjs')
const toHex = (number, length = 32) => '0x' + (number instanceof Buffer ? number.toString('hex') : bigInt(number).toString(16)).padStart(length * 2, '0')


module.exports = function(deployer, network, accounts) {
  return deployer.then(async () => {
    const tree = new MerkleTree(MERKLE_TREE_HEIGHT)
    const root = await tree.root()
    const verifier = await Verifier.deployed()

    const tornado = await deployer.deploy(TornadoPool, verifier.address, toHex(root))
    console.log('TornadoPool\'s address ', tornado.address)
  })
}
