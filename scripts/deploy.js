const { ethers } = require('hardhat')

const MERKLE_TREE_HEIGHT = 23

async function main() {
  require('../scripts/compileHasher')
  const govAddress = '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce'
  const omniBridge = '0x59447362798334d3485c64D1e4870Fde2DDC0d75'
  const token = '0xCa8d20f3e0144a72C6B5d576e9Bd3Fd8557E2B04' // WBNB
  const l1Unwrapper = '0xefc33f8b2c4d51005585962be7ea20518ea9fd0d' // WBNB -> BNB

  const Verifier2 = await ethers.getContractFactory('Verifier2')
  const verifier2 = await Verifier2.deploy()
  await verifier2.deployed()
  console.log(`verifier2: ${verifier2.address}`)

  const Verifier16 = await ethers.getContractFactory('Verifier16')
  const verifier16 = await Verifier16.deploy()
  await verifier16.deployed()
  console.log(`verifier16: ${verifier16.address}`)

  const Hasher = await await ethers.getContractFactory('Hasher')
  const hasher = await Hasher.deploy()

  const Pool = await ethers.getContractFactory('TornadoPool')
  const tornado = await Pool.deploy(
    verifier2.address,
    verifier16.address,
    MERKLE_TREE_HEIGHT,
    hasher.address,
    token,
    omniBridge,
    l1Unwrapper,
  )
  await tornado.deployed()
  console.log(`TornadoPool address: ${tornado.address}`)

  const CrossChainUpgradeableProxy = await ethers.getContractFactory('CrossChainUpgradeableProxy')
  const proxy = await CrossChainUpgradeableProxy.deploy(tornado.address, govAddress, [], omniBridge)
  await proxy.deployed()
  console.log(`proxy address: ${proxy.address}`)

  const tornadoPool = Pool.attach(proxy.address)
  await tornadoPool.initialize()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
