
const Hasher = require('../lib/mimc')
const hasher = new Hasher()
const { bigInt } = require('snarkjs')

export class Utxo {
  amount: bigint;
  blinding: bigint;
  privateKey: bigint;

  // commitment: bigint;
  // treeIndex: Boolean[];
  // nullifier: bigint;

  constructor(amount?: bigint, blinding?: bigint, privateKey?: bigint) {
    this.amount = amount || bigInt(0);
    this.blinding = blinding || bigInt(0);
    this.privateKey = privateKey || bigInt(0);
  }

  publicKey() {
    return hasher.hashArray([this.privateKey])
  }
}

