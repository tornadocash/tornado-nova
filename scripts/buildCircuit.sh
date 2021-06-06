#!/bin/bash -e
mkdir -p artifacts/circuits
npx circom -v -r artifacts/circuits/$1.r1cs -w artifacts/circuits/$1.wasm -s artifacts/circuits/$1.sym circuits/$1.circom
zkutil setup -c artifacts/circuits/$1.r1cs -p artifacts/circuits/$1.params
zkutil generate-verifier -p artifacts/circuits/$1.params -v artifacts/circuits/Verifier.sol
npx snarkjs info -r artifacts/circuits/$1.r1cs
