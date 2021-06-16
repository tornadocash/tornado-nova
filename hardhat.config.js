require('@nomiclabs/hardhat-waffle')
require('dotenv').config()

const config = {
  solidity: {
    version: '0.6.12',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // goerli: {
    //   url: process.env.ETH_RPC,
    //   accounts: process.env.PRIVATE_KEY
    //     ? [process.env.PRIVATE_KEY]
    //     : {
    //         mnemonic: 'test test test test test test test test test test test junk',
    //       },
    // },
  },
  mocha: {
    timeout: 600000000,
  },
}

module.exports = config
