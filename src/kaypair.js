const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { randomBN, poseidonHash, toFixedHex } = require('./utils')

class Keypair {
  constructor(privkey = randomBN()) {
    this.privkey = privkey
    this.pubkey = poseidonHash([this.privkey])
    this.encryptionKey = 0 // todo
  }

  toString() {
    return toFixedHex(this.pubkey) + toFixedHex(this.encryptionKey).slice(2)
  }

  static fromString(str) {
    if (str.length === 130) {
      str = str.slice(2)
    }
    if (str.length !== 128) {
      throw new Error('Invalid key length')
    }
    return Object.assign(new Keypair(), {
      privkey: null,
      pubkey: BigNumber.from('0x' + str.slice(0, 64)),
      encryptionKey: BigNumber.from('0x' + str.slice(64, 128)),
    })
  }
}

module.exports = Keypair
