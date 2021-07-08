require('@nomiclabs/hardhat-waffle')
require('@eth-optimism/hardhat-ovm')
require('dotenv').config()

const config = {
  solidity: {
    version: '0.7.6',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  ovm: {
    solcVersion: '0.7.6+commit.3b061308',
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
    optimism: {
      url: process.env.ETH_RPC,
      accounts: process.env.PRIVATE_KEY
        ? [process.env.PRIVATE_KEY]
        : {
            mnemonic: 'test test test test test test test test test test test junk',
          },
      // This sets the gas price to 0 for all transactions on L2. We do this
      // because account balances are not automatically initiated with an ETH
      // balance (yet, sorry!).
      gasPrice: 15000000,
      ovm: true, // This sets the network as using the ovm and ensure contract will be compiled against that.
    },
  },
  mocha: {
    timeout: 600000000,
  },
}

module.exports = config
