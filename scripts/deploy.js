const { ethers } = require('hardhat')

const MERKLE_TREE_HEIGHT = 23
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
  const govAddress = '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce'
  const crossDomainMessenger = '0x4200000000000000000000000000000000000007'

  const Verifier2 = await ethers.getContractFactory('Verifier2')
  const verifier2 = await Verifier2.deploy()
  await verifier2.deployed()
  console.log(`verifier2: ${verifier2.address}`)

  const Verifier16 = await ethers.getContractFactory('Verifier16')
  const verifier16 = await Verifier16.deploy()
  await verifier16.deployed()
  console.log(`verifier16: ${verifier16.address}`)

  const tree = new MerkleTree(MERKLE_TREE_HEIGHT, [], { hashFunction: poseidonHash2 })
  const root = await tree.root()
  console.log('root', toFixedHex(root))

  const Pool = await ethers.getContractFactory('TornadoPool')
  const tornado = await Pool.deploy(verifier2.address, verifier16.address)
  await tornado.deployed()
  console.log(`TornadoPool address: ${tornado.address}`)

  const CrossChainUpgradeableProxy = await ethers.getContractFactory('CrossChainUpgradeableProxy')
  const proxy = await CrossChainUpgradeableProxy.deploy(tornado.address, govAddress, [], crossDomainMessenger)
  await proxy.deployed()
  console.log(`proxy address: ${proxy.address}`)

  const tornadoPool = Pool.attach(proxy.address)

  await tornadoPool.initialize(toFixedHex(root))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
