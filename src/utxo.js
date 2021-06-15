const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { randomBN, poseidonHash } = require('./utils')
const Keypair = require('./keypair')

class Utxo {
  constructor({ amount = 0, keypair = new Keypair(), blinding = randomBN(), index } = {}) {
    this.amount = BigNumber.from(amount)
    this.blinding = BigNumber.from(blinding)
    this.keypair = keypair
    this.index = index
  }

  getCommitment() {
    if (!this._commitment) {
      this._commitment = poseidonHash([this.amount, this.blinding, this.keypair.pubkey])
    }
    return this._commitment
  }

  getNullifier() {
    if (!this._nullifier) {
      if (this.amount > 0 && (this.index === undefined || this.keypair.privkey === undefined || this.keypair.privkey === null)) {
        throw new Error('Can not compute nullifier without utxo index or private key')
      }
      this._nullifier = poseidonHash([this.getCommitment(), this.index || 0, this.keypair.privkey || 0])
    }
    return this._nullifier
  }

  encrypt() {
    const blindingBuf = Buffer.from(this.blinding.toHexString().slice(2), 'hex')
    const amountBuf = Buffer.from(this.amount.toHexString().slice(2), 'hex')
    const bytes = Buffer.concat([
      Buffer.alloc(31 - blindingBuf.length),
      blindingBuf,
      Buffer.alloc(31 - amountBuf.length),
      amountBuf,
    ])
    return this.keypair.encrypt(bytes)
  }

  static decrypt(keypair, data, index) {
    const buf = keypair.decrypt(data)
    return new Utxo({
      blinding: BigNumber.from('0x' + buf.slice(0, 31).toString('hex')),
      amount: BigNumber.from('0x' + buf.slice(31, 62).toString('hex')),
      keypair,
      index,
    })
  }
}

module.exports = Utxo
