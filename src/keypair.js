const { encrypt, decrypt, getEncryptionPublicKey } = require('eth-sig-util')
const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { randomBN, poseidonHash, toFixedHex } = require('./utils')
const BNjs = require('bn.js')

class Keypair {
  constructor(privkey = ethers.Wallet.createRandom().privateKey) {
    this.privkey = privkey
    this.pubkey = poseidonHash([this.privkey])
    this.encryptionKey = getEncryptionPublicKey(privkey.slice(2))
  }

  toString() {
    return toFixedHex(this.pubkey) + Buffer.from(this.encryptionKey, 'base64').toString('hex')
  }

  address() {
    return this.toString()
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
      encryptionKey: Buffer.from(str.slice(64, 128), 'hex').toString('base64'),
    })
  }

  encrypt({ blinding, amount }) {
    const bytes = Buffer.concat([
      new BNjs(blinding.toString()).toBuffer('be', 31),
      new BNjs(amount.toString()).toBuffer('be', 31),
    ])
    return encrypt(this.encryptionKey, { data: bytes.toString('base64') }, 'x25519-xsalsa20-poly1305')
  }

  decrypt(data) {
    const decryptedMessage = decrypt(data, this.privkey.slice(2))
    const buf = Buffer.from(decryptedMessage, 'base64')
    return {
      blinding: BigNumber.from('0x' + buf.slice(0, 31).toString('hex')),
      amount: BigNumber.from('0x' + buf.slice(31, 62).toString('hex')),
    }
  }
}

module.exports = Keypair
