#!/bin/bash -e
POWERS_OF_TAU=18 # circuit will support max 2^POWERS_OF_TAU constraints
mkdir -p artifacts/circuits
if [ ! -f artifacts/circuits/ptau$POWERS_OF_TAU ]; then
  echo "Downloading powers of tau file"
  curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_$POWERS_OF_TAU.ptau --create-dirs -o artifacts/circuits/ptau$POWERS_OF_TAU
fi
npx circom -v -r artifacts/circuits/transaction$1.r1cs -w artifacts/circuits/transaction$1.wasm -s artifacts/circuits/transaction$1.sym circuits/transaction$1.circom
npx snarkjs groth16 setup artifacts/circuits/transaction$1.r1cs artifacts/circuits/ptau$POWERS_OF_TAU artifacts/circuits/transaction$1_0.zkey
npx snarkjs zkey contribute artifacts/circuits/transaction$1_0.zkey artifacts/circuits/transaction$1_1.zkey
npx snarkjs zkey beacon artifacts/circuits/transaction$1_1.zkey artifacts/circuits/transaction$1.zkey e586fccaf245c9a1d7e78294d4802018f3001149a71b8f10cd997ef8235aa372 10
npx snarkjs zkey export solidityverifier artifacts/circuits/transaction$1.zkey artifacts/circuits/Verifier$1.sol
sed -i.bak "s/contract Verifier/contract Verifier${1}/g" artifacts/circuits/Verifier$1.sol
npx snarkjs info -r artifacts/circuits/transaction$1.r1cs
