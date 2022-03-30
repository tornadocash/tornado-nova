const { ethers } = require('hardhat')
const config = require('../config')
const { generate } = require('../src/0_generateAddresses')

// This script deploys Tornado Pool upgrade to L2 (Gnosis Chain)

async function deploy({ address, bytecode, singletonFactory }) {
  const contractCode = await ethers.provider.getCode(address)
  if (contractCode !== '0x') {
    console.log(`Contract ${address} already deployed. Skipping...`)
    return
  }
  await singletonFactory.deploy(bytecode, config.salt, { gasLimit: 5000000 })
}

async function main() {
  const singletonFactory = await ethers.getContractAt('SingletonFactory', config.singletonFactory)
  const contracts = await generate()
  await deploy({ ...contracts.poolContract, singletonFactory })
  console.log(`Upgraded pool contract have been deployed on ${contracts.poolContract.address} address`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
