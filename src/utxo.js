const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { randomBN, poseidonHash } = require('./utils')

function fromPrivkey(privkey) {
  return {
    privkey,
    pubkey: poseidonHash([privkey]),
  }
}

class Utxo {
  constructor({ amount, pubkey, privkey, blinding, index } = {}) {
    if (!pubkey) {
      if (privkey) {
        pubkey = fromPrivkey(privkey).pubkey
      } else {
        ;({ pubkey, privkey } = fromPrivkey(randomBN()))
      }
    }
    this.amount = BigNumber.from(amount || 0)
    this.blinding = blinding || randomBN()
    this.pubkey = pubkey
    this.privkey = privkey
    this.index = index
  }

  getCommitment() {
    if (!this._commitment) {
      this._commitment = poseidonHash([this.amount, this.blinding, this.pubkey])
    }
    return this._commitment
  }

  getNullifier() {
    if (!this._nullifier) {
      if (this.amount > 0 && (this.index === undefined || !this.privkey === undefined)) {
        throw new Error('Can not compute nullifier without utxo index or private key')
      }
      this._nullifier = poseidonHash([this.getCommitment(), this.index || 0, this.privkey || 0])
    }
    return this._nullifier
  }
}

module.exports = Utxo
