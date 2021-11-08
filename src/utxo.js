const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { randomBN, poseidonHash, toBuffer } = require('./utils')
const { Keypair } = require('./keypair')

class Utxo {
  /** Initialize a new UTXO - unspent transaction output or input. Note, a full TX consists of 2/16 inputs and 2 outputs
   *
   * @param {BigNumber | BigInt | number | string} amount UTXO amount
   * @param {BigNumber | BigInt | number | string} blinding Blinding factor
   * @param {Keypair} keypair
   * @param {number|null} index UTXO index in the merkle tree
   */
  constructor({ amount = 0, keypair = new Keypair(), blinding = randomBN(), index = null } = {}) {
    this.amount = BigNumber.from(amount)
    this.blinding = BigNumber.from(blinding)
    this.keypair = keypair
    this.index = index
  }

  /**
   * Returns commitment for this UTXO
   *
   * @returns {BigNumber}
   */
  getCommitment() {
    if (!this._commitment) {
      this._commitment = poseidonHash([this.amount, this.keypair.pubkey, this.blinding])
    }
    return this._commitment
  }

  /**
   * Returns nullifier for this UTXO
   *
   * @returns {BigNumber}
   */
  getNullifier() {
    if (!this._nullifier) {
      if (
        this.amount > 0 &&
        (this.index === undefined ||
          this.index === null ||
          this.keypair.privkey === undefined ||
          this.keypair.privkey === null)
      ) {
        throw new Error('Can not compute nullifier without utxo index or private key')
      }
      const signature = this.keypair.privkey ? this.keypair.sign(this.getCommitment(), this.index || 0) : 0
      this._nullifier = poseidonHash([this.getCommitment(), this.index || 0, signature])
    }
    return this._nullifier
  }

  /**
   * Encrypt UTXO data using the current keypair
   *
   * @returns {string} `0x`-prefixed hex string with data
   */
  encrypt() {
    const bytes = Buffer.concat([toBuffer(this.amount, 31), toBuffer(this.blinding, 31)])
    return this.keypair.encrypt(bytes)
  }

  /**
   * Decrypt a UTXO
   *
   * @param {Keypair} keypair keypair used to decrypt
   * @param {string} data hex string with data
   * @param {number} index UTXO index in merkle tree
   * @returns {Utxo}
   */
  static decrypt(keypair, data, index) {
    const buf = keypair.decrypt(data)
    return new Utxo({
      amount: BigNumber.from('0x' + buf.slice(0, 31).toString('hex')),
      blinding: BigNumber.from('0x' + buf.slice(31, 62).toString('hex')),
      keypair,
      index,
    })
  }
}

module.exports = Utxo
