include "../node_modules/circomlib/circuits/pointbits.circom";
include "../node_modules/circomlib/circuits/compconstant.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";


template Keypair() {
    signal input privateKey;
    signal output publicKey;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== privateKey;
    publicKey <== hasher.out;
}

template TransactionHasher() {
    signal input amount;
    signal input blinding;
    signal input publicKey;
    signal output commitment;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== amount;
    hasher.inputs[1] <== blinding;
    hasher.inputs[2] <== publicKey;
    commitment <== hasher.out;
}

template NullifierHasher() {
    signal input commitment;
    signal input merklePath;
    signal input privateKey;
    signal output nullifier;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== commitment;
    hasher.inputs[1] <== merklePath;
    hasher.inputs[2] <== privateKey;
    nullifier <== hasher.out;
}
