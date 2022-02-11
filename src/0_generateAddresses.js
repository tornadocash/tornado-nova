const { ethers } = require('hardhat')
const defaultConfig = require('../config')

async function generate(config = defaultConfig) {
  const singletonFactory = await ethers.getContractAt('SingletonFactory', config.singletonFactory)

  const UnwrapperFactory = await ethers.getContractFactory('L1Unwrapper')
  const deploymentBytecodeUnwrapper =
    UnwrapperFactory.bytecode +
    UnwrapperFactory.interface.encodeDeploy([config.omniBridge, config.weth, config.multisig]).slice(2)

  const unwrapperAddress = ethers.utils.getCreate2Address(
    singletonFactory.address,
    config.salt,
    ethers.utils.keccak256(deploymentBytecodeUnwrapper),
  )

  const PoolFactory = await ethers.getContractFactory('TornadoPool')
  const deploymentBytecodePool =
    PoolFactory.bytecode +
    PoolFactory.interface
      .encodeDeploy([
        config.verifier2,
        config.verifier16,
        config.MERKLE_TREE_HEIGHT,
        config.hasher,
        config.gcWeth,
        config.gcOmniBridge,
        config.l1Unwrapper,
        config.govAddress,
        config.l1ChainId,
        config.gcMultisig,
      ])
      .slice(2)

  const poolAddress = ethers.utils.getCreate2Address(
    singletonFactory.address,
    config.salt,
    ethers.utils.keccak256(deploymentBytecodePool),
  )

  const result = {
    unwrapperContract: {
      address: unwrapperAddress,
      bytecode: deploymentBytecodeUnwrapper,
      isProxy: false,
    },
    poolContract: {
      address: poolAddress,
      bytecode: deploymentBytecodePool,
      isProxy: false,
    },
  }

  return result
}

async function generateWithLog() {
  const contracts = await generate()
  console.log('L1 unwrapper contract: ', contracts.unwrapperContract.address)
  console.log('Upgraded pool contract: ', contracts.poolContract.address)
  return contracts
}

module.exports = {
  generate,
  generateWithLog,
}
