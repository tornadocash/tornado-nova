include "../node_modules/circomlib/circuits/pointbits.circom";
include "../node_modules/circomlib/circuits/compconstant.circom";
include "../node_modules/circomlib/circuits/mimcsponge.circom";


template Keypair() {
    signal input privateKey;
    signal output publicKey;

    publicKey <== privateKey;
    // todo
}

template TransactionHasher() {
    signal input amount;
    signal input blinding;
    signal input publicKey;

    signal output commitment;

    component hasher = MiMCSponge(3, 1);
    hasher.ins[0] <== amount;
    hasher.ins[1] <== blinding;
    hasher.ins[2] <== publicKey;
    hasher.k <== 0;

    commitment <== hasher.outs[0];
}

template NullifierHasher() {
    signal input privateKey;
    signal input merklePath;
    signal input commitment;

    signal output nullifier;

    component hasher = MiMCSponge(3, 1);
    hasher.ins[0] <== commitment;
    hasher.ins[1] <== merklePath;
    hasher.ins[2] <== privateKey;
    hasher.k <== 0;

    nullifier <== hasher.outs[0];
}
