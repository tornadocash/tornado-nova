
import BigNumber from "bignumber.js"

class UTXO {
  amount: BigNumber;
  blinding: BigNumber;
  pubkey: BigNumber;
  privkey: BigNumber;
  commitment: BigNumber;
  treeIndex: Boolean[];
  nullifier: BigNumber;

  constructor(
    amount,
    blinding,
    pubkey,
    privkey,
    commitment,
    treeIndex,
    nullifier,
  ) {

  }
}

class Transaction {
  inputs: UTXO[];
  outputs: UTXO[];

}

async function main() {
  const deposit = new UTXO();
}

main()
