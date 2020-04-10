
import BigNumber from "bignumber.js"

import { Utxo } from './Utxo'
const { bigInt } = require('snarkjs')
const crypto = require('crypto')
const rbigint = (nbytes = 31) => bigInt.leBuff2int(crypto.randomBytes(nbytes))

async function main() {
  const zeroUtxo = new Utxo(bigInt(0), rbigint(), rbigint())
  console.log('zeroUtxo publicKey', zeroUtxo.publicKey())
}

main()
