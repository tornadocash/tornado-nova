include "./merkleTree.circom"
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

// Universal JoinSplit transaction with 2 inputs and 2 outputs
template Transaction(levels, nIns, nOuts, zeroLeaf) {
    signal input root;
    signal input newRoot;
    signal input inputNullifier[nIns];
    signal input outputCommitment[nOuts];
    // external amount used for deposits and withdrawals
    // correct extAmount range is enforced on the smart contract
    signal input extAmount;
    signal input fee;
    signal input extDataHash;

    // data for transaction inputs
    signal private input inAmount[nIns];
    signal private input inBlinding[nIns];
    signal private input inPrivateKey[nIns];
    signal private input inPathIndices[nIns];
    signal private input inPathElements[nIns][levels];

    // data for transaction outputs
    signal private input outAmount[nOuts];
    signal private input outBlinding[nOuts];
    signal private input outPubkey[nOuts];
    signal private input outPathIndices;
    signal private input outPathElements[levels - 1];

    component inKeypair[nIns];
    component inUtxoHasher[nIns];
    component nullifierHasher[nIns];
    component inAmountCheck[nIns];
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

        tree[tx] = MerkleTree(levels);
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

        // Check that amount fits into 248 bits to prevent overflow
        inAmountCheck[tx] = Num2Bits(248);
        inAmountCheck[tx].in <== inAmount[tx];

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

    // Check that fee fits into 248 bits to prevent overflow
    component feeCheck = Num2Bits(248);
    feeCheck.in <== fee;

    component sameNullifiers = IsEqual();
    sameNullifiers.in[0] <== inputNullifier[0];
    sameNullifiers.in[1] <== inputNullifier[1];
    sameNullifiers.out === 0;

    // verify amount invariant
    sumIns + extAmount === sumOuts + fee;

    // Check merkle tree update with inserted transaction outputs
    component treeUpdater = TreeUpdater(levels, zeroLeaf);
    treeUpdater.oldRoot <== root;
    treeUpdater.newRoot <== newRoot;
    treeUpdater.leaf[0] <== outputCommitment[0];
    treeUpdater.leaf[1] <== outputCommitment[1];
    treeUpdater.pathIndices <== outPathIndices;
    for (var i = 0; i < levels - 1; i++) {
        treeUpdater.pathElements[i] <== outPathElements[i];
    }
}
