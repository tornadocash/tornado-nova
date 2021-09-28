const { ethers } = require('hardhat')

const MERKLE_TREE_HEIGHT = 23

async function main() {
  require('./compileHasher')
  const Verifier2 = await ethers.getContractFactory('Verifier2')
  const verifier2 = await Verifier2.deploy()
  await verifier2.deployed()
  console.log(`verifier2: ${verifier2.address}`)

  const Verifier16 = await ethers.getContractFactory('Verifier16')
  const verifier16 = await Verifier16.deploy()
  await verifier16.deployed()
  console.log(`verifier16: ${verifier16.address}`)

  const Hasher = await ethers.getContractFactory('Hasher')
  const hasher = await Hasher.deploy()
  await hasher.deployed()

  const Pool = await ethers.getContractFactory('TornadoPool')
  const tornado = await Pool.deploy(verifier2.address, verifier16.address, MERKLE_TREE_HEIGHT, hasher.address)
  await tornado.deployed()
  console.log(`TornadoPool address: ${tornado.address}`)

  await tornado.initialize()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
