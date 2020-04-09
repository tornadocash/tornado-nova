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
template Transaction(levels, zeroLeaf) {
    signal input root;
    signal input newRoot;
    signal input inputNullifier[2];
    signal input outputCommitment[2];
    // external amount used for deposits and withdrawals
    // correct extAmount range is enforced on the smart contract
    signal input extAmount;
    signal input fee;
    signal input recipient;
    signal input relayer;

    signal private input privateKey;

    // data for 2 transaction inputs
    signal private input inAmount[2];
    signal private input inBlinding[2];
    signal private input inPathIndices[2];
    signal private input inPathElements[2][levels];

    // data for 2 transaction outputs
    signal private input outAmount[2];
    signal private input outBlinding[2];
    signal private input outPathIndices;
    signal private input outPathElements[levels - 1];

    component inUtxoHasher[2];
    component outUtxoHasher[2];
    component nullifierHasher[2];
    component checkRoot[2]
    component tree[2];
    component inAmountCheck[2];
    component outAmountCheck[2];

    component keypair = Keypair();
    keypair.privateKey <== privateKey;

    // verify correctness of transaction inputs
    for (var tx = 0; tx < 2; tx++) {
        inUtxoHasher[tx] = TransactionHasher();
        inUtxoHasher[tx].amount <== inAmount[tx];
        inUtxoHasher[tx].blinding <== inBlinding[tx];
        inUtxoHasher[tx].publicKey <== keypair.publicKey;

        nullifierHasher[tx] = NullifierHasher();
        nullifierHasher[tx].commitment <== inUtxoHasher[tx].commitment;
        nullifierHasher[tx].merklePath <== inPathIndices[tx];
        nullifierHasher[tx].privateKey <== keypair.privateKey;
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
    }

    // verify correctness of transaction outputs
    for (var tx = 0; tx < 2; tx++) {
        outUtxoHasher[tx] = TransactionHasher();
        outUtxoHasher[tx].amount <== outAmount[tx];
        outUtxoHasher[tx].blinding <== outBlinding[tx];
        outUtxoHasher[tx].publicKey <== keypair.publicKey;
        outUtxoHasher[tx].commitment === outputCommitment[tx];

        // Check that amount fits into 248 bits to prevent overflow
        outAmountCheck[tx] = Num2Bits(248);
        outAmountCheck[tx].in <== outAmount[tx];
    }

    // Check that fee fits into 248 bits to prevent overflow
    component feeCheck = Num2Bits(248);
    feeCheck.in <== fee;

    component sameNullifiers = IsEqual();
    sameNullifiers.in[0] <== inputNullifier[0];
    sameNullifiers.in[1] <== inputNullifier[1];
    sameNullifiers.out === 0;

    // verify amount invariant
    inAmount[0] + inAmount[1] + extAmount === outAmount[0] + outAmount[1] + fee;

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

component main = Transaction(5, 3193090221241211970002919215846211184824251841300455796635909287157453409439);
