include "../node_modules/circomlib/circuits/poseidon.circom";

// Since we don't use signatures, the keypair can be based on a simple hash
template Keypair() {
    signal input privateKey;
    signal output publicKey;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== privateKey;
    publicKey <== hasher.out;
}

template Signature() {
    signal input privateKey;
    signal input merklePath;
    signal output out;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== privateKey;
    hasher.inputs[1] <== merklePath;
    out <== hasher.out;
}
