
import BigNumber from "bignumber.js"

class UTXO {
  amount: BigNumber;
  blinding: BigNumber;
  pubkey: BigNumber;
}

async function main() {
  const deposit = new UTXO();
}

main()
