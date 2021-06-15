const { encrypt, decrypt, getEncryptionPublicKey } = require('eth-sig-util')
const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { randomBN, poseidonHash, toFixedHex } = require('./utils')

class Keypair {
  constructor(privkey = ethers.Wallet.createRandom().privateKey) {
    this.privkey = privkey
    console.log(privkey)
    this.pubkey = poseidonHash([this.privkey])
    this.encryptionKey = getEncryptionPublicKey(privkey.slice(2))
    console.log('enc key', this.encryptionKey)
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

  encrypt({ blinding, amount }) {
    console.log(BigNumber.from(blinding).toHexString())
    const bytes = Buffer.concat([
      Buffer.from(BigNumber.from(blinding).toHexString(), 0, 31),
      Buffer.from(BigNumber.from(amount).toHexString(), 0, 31),
    ])
    console.log(bytes)
    return encrypt(this.encryptionKey, { data: bytes.toString('base64') }, 'x25519-xsalsa20-poly1305')
  }

  decrypt(data) {
    const decryptedMessage = decrypt(data, this.privkey.slice(2))
    const buf = Buffer.from(decryptedMessage, 'base64')
    console.log(buf)
    return {
      blinding: BigNumber.from('0x' + buf.slice(0, 31).toString('hex')),
      amount: BigNumber.from('0x' + buf.slice(31, 62).toString('hex')),
    }
  }
}

module.exports = Keypair
