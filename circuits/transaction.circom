include "./merkleProof.circom"
include "./treeUpdater.circom"
include "./utils.circom"

/*
Utxo structure:
{
    amount,
    blinding, // random number
    pubkey,
}

commitment = hash(amount, blinding, pubKey)
nullifier = hash(commitment, privKey, merklePath)
*/

// Universal JoinSplit transaction with nIns inputs and 2 outputs
template Transaction(levels, nIns, nOuts, zeroLeaf) {
    signal input root;
    // extAmount = external amount used for deposits and withdrawals
    // correct extAmount range is enforced on the smart contract
    // publicAmount = extAmount - fee
    signal input publicAmount;
    signal input extDataHash;

    // data for transaction inputs
    signal         input inputNullifier[nIns];
    signal private input inAmount[nIns];
    signal private input inBlinding[nIns];
    signal private input inPrivateKey[nIns];
    signal private input inPathIndices[nIns];
    signal private input inPathElements[nIns][levels];

    // data for transaction outputs
    signal         input outputCommitment[nOuts];
    signal private input outAmount[nOuts];
    signal private input outBlinding[nOuts];
    signal private input outPubkey[nOuts];
    signal private input outPathIndices;
    signal private input outPathElements[levels - 1];

    component inKeypair[nIns];
    component inUtxoHasher[nIns];
    component nullifierHasher[nIns];
    component tree[nIns];
    component checkRoot[nIns];
    var sumIns = 0;

    // verify correctness of transaction inputs
    for (var tx = 0; tx < nIns; tx++) {
        inKeypair[tx] = Keypair();
        inKeypair[tx].privateKey <== inPrivateKey[tx];

        inUtxoHasher[tx] = TransactionHasher();
        inUtxoHasher[tx].amount <== inAmount[tx];
        inUtxoHasher[tx].blinding <== inBlinding[tx];
        inUtxoHasher[tx].publicKey <== inKeypair[tx].publicKey;

        nullifierHasher[tx] = NullifierHasher();
        nullifierHasher[tx].commitment <== inUtxoHasher[tx].commitment;
        nullifierHasher[tx].merklePath <== inPathIndices[tx];
        nullifierHasher[tx].privateKey <== inPrivateKey[tx];
        nullifierHasher[tx].nullifier === inputNullifier[tx];

        tree[tx] = MerkleProof(levels);
        tree[tx].leaf <== inUtxoHasher[tx].commitment;
        tree[tx].pathIndices <== inPathIndices[tx];
        for (var i = 0; i < levels; i++) {
            tree[tx].pathElements[i] <== inPathElements[tx][i];
        }

        // check merkle proof only if amount is non-zero
        checkRoot[tx] = ForceEqualIfEnabled();
        checkRoot[tx].in[0] <== root;
        checkRoot[tx].in[1] <== tree[tx].root;
        checkRoot[tx].enabled <== inAmount[tx];

        // We don't need to range check input amounts, since all inputs are valid UTXOs that 
        // were already checked as outputs in the previous transaction (or zero amount UTXOs that don't 
        // need to be checked either).

        sumIns += inAmount[tx];
    }

    component outUtxoHasher[nOuts];
    component outAmountCheck[nOuts];
    var sumOuts = 0;

    // verify correctness of transaction outputs
    for (var tx = 0; tx < nOuts; tx++) {
        outUtxoHasher[tx] = TransactionHasher();
        outUtxoHasher[tx].amount <== outAmount[tx];
        outUtxoHasher[tx].blinding <== outBlinding[tx];
        outUtxoHasher[tx].publicKey <== outPubkey[tx];
        outUtxoHasher[tx].commitment === outputCommitment[tx];

        // Check that amount fits into 248 bits to prevent overflow
        outAmountCheck[tx] = Num2Bits(248);
        outAmountCheck[tx].in <== outAmount[tx];

        sumOuts += outAmount[tx];
    }

    // check that there are no same nullifiers among all inputs
    component sameNullifiers[nIns * (nIns - 1) / 2];
    var index = 0;
    for (var i = 0; i < nIns - 1; i++) {
      for (var j = i + 1; j < nIns; j++) {
          sameNullifiers[index] = IsEqual();
          sameNullifiers[index].in[0] <== inputNullifier[i];
          sameNullifiers[index].in[1] <== inputNullifier[j];
          sameNullifiers[index].out === 0;
          index++;
      }
    }

    // verify amount invariant
    sumIns + publicAmount === sumOuts;

    // optional safety constraint to make sure extDataHash cannot be changed
    signal extDataSquare <== extDataHash * extDataHash;
}
