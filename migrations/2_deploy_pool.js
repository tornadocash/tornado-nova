/* global artifacts */
const Verifier = artifacts.require('Verifier')
const TornadoPool = artifacts.require('TornadoPool')

module.exports = function(deployer, network, accounts) {
  return deployer.then(async () => {
    const verifier = await Verifier.deployed()
    const tornado = await deployer.deploy(TornadoPool, verifier.address)
    console.log('TornadoPool\'s address ', tornado.address)
  })
}
