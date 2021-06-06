const { ethers } = require('hardhat')

const MERKLE_TREE_HEIGHT = 5
const MerkleTree = require('fixed-merkle-tree')
const { poseidon } = require('circomlib')
const poseidonHash = (items) => ethers.BigNumber.from(poseidon(items).toString())
const poseidonHash2 = (a, b) => poseidonHash([a, b])

const toFixedHex = (number, length = 32) =>
  '0x' +
  (number instanceof Buffer
    ? number.toString('hex')
    : ethers.BigNumber.from(number).toHexString().slice(2)
  ).padStart(length * 2, '0')

async function main() {
  const Verifier = await ethers.getContractFactory('Verifier')
  const verifier = await Verifier.deploy()
  await verifier.deployed()
  console.log(`verifier: ${verifier.address}`)

  const tree = new MerkleTree(MERKLE_TREE_HEIGHT, [], { hashFunction: poseidonHash2 })
  const root = await tree.root()

  const Pool = await ethers.getContractFactory('TornadoPool')
  const tornado = await Pool.deploy(verifier.address, toFixedHex(root))
  console.log("TornadoPool's address ", tornado.address)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
