const MERKLE_TREE_HEIGHT = 10;

function rbigint(bytes = 31) {

}

function randomBoolArray(length) {

}

function randomArray(length) {

}

function hash(dataArray) {
    for(let item of dataArray) {

    }
}

function merklePathIndicesToBigint(indexArray) {

}

function fromPrivkey(privkey) {
    return {
        privkey,
        pubkey: privkey,
    }
}

function randomKeypair() {
    return fromPrivkey(rbigint())
}

function createZeroUtxo(keypair) {
    return createUtxo(0, rbigint(), keypair.pubkey, keypair.privkey, randomBoolArray(MERKLE_TREE_HEIGHT), randomArray(MERKLE_TREE_HEIGHT))
}

function createOutput(amount, pubkey) {
    if (!pubkey) {
        throw new Error('no pubkey')
    }
    return createUtxo(amount, rbigint(), pubkey)
}

function createInput(amount, blinding, pubkey, privkey, merklePathIndices, merklePathElements) {
    return createUtxo(amount, blinding, pubkey, privkey, merklePathIndices, merklePathElements)
}

/// unsafe function without sanity checks
function createUtxo(amount, blinding, pubkey, privkey, merklePathIndices, merklePathElements) {
    let utxo = { amount, blinding, pubkey, privkey, merklePathIndices, merklePathElements }
    utxo.commitment = hash([amount, blinding, pubkey])
    if (privkey) {
        utxo.nullifier = hash([commitment, merklePathIndicesToBigint(merklePathIndices), privkey])
    }
    return utxo
}

function createDeposit(amount, pubkey) {
    const keypair = randomKeypair()
    const tx = {
        inputs: [createZeroUtxo(keypair), createZeroUtxo(keypair)],
        outputs: [createOutput(amount, pubkey), createZeroUtxo()], // todo shuffle
    }
    return tx;
}

async function buildMerkleTree() {
    console.log('Getting contract state...')
    const events = await contract.getPastEvents('NewCommitment', { fromBlock: 0, toBlock: 'latest' })
    const leaves = events
      .sort((a, b) => a.returnValues.index - b.returnValues.index) // todo sort by event date
      .map(e => e.returnValues.commitment)
    return new merkleTree(MERKLE_TREE_HEIGHT, leaves)
}

function insertTransaction(tree, tx) {
    let path = await tree.insertPair(tx.outputs[0].commitment, tx.outputs[1].commitment)

    tx.outputs[0].merklePath = [...path, 0]
    tx.outputs[1].merklePath = [...path, 1]
}

async function main() {
    const amount = 1e6;

    const tree = await buildMerkleTree()
    const oldRoot = tree.root;
    const keypair = randomKeypair()
    const tx = createDeposit(amount, keypair.pubkey)
    insertTransaction(tree, tx)

    let input = {
        root: oldRoot,
        newRoot: tree.root,
        inputNullifier: [tx.inputs[0].nullifier, tx.inputs[1].nullifier],
        outputCommitment: [tx.outputs[0].commitment, tx.outputs[1].commitment],
        extAmount: amount,
        fee: 0,
        recipient: 0,
        relayer: 0,
    
        // private inputs
        privateKey: tx.inputs[0].privkey,
    
        // data for 2 transaction inputs
        inAmount: [tx.inputs[0].amount, tx.inputs[1].amount],
        inBlinding: [tx.inputs[0].blinding, tx.inputs[1].blinding],
        inPathIndices: [merklePathIndicesToBigint(tx.inputs[0].merklePathIndices), merklePathIndicesToBigint(tx.inputs[1].merklePathIndices)],
        inPathElements: [tx.inputs[0].merklePathElements, tx.inputs[1].merklePathElements],
    
        // data for 2 transaction outputs
        outAmount: [tx.outputs[0].amount, tx.outputs[1].amount],
        outBlinding: [tx.outputs[0].blinding, tx.outputs[1].blinding],
        outPathIndices: merklePathIndicesToBigint(tx.outputs[0].merklePathIndices.slice(0, -1)),
        outPathElements: tx.outputs[0].merklePathElements.slice(0, -1)
    }

    console.log('Generating SNARK proof...')
    const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
    const { proof } = websnarkUtils.toSolidityInput(proofData)

    const args = [
        toHex(input.root),
        toHex(input.newRoot),
        [toHex(input.inputs[0].nullifier), toHex(input.inputs[1].nullifier)],
        [toHex(input.inputs[0].commitment), toHex(input.inputs[1].commitment)],
        toHex(input.amount),
        toHex(input.fee),
        toHex(input.recipient, 20),
        toHex(input.relayer, 20),
    ]

    console.log('Sending withdrawal transaction...')
    const receipt = await contract.methods.transaction(proof, ...args).send({ valued: amount, from: web3.eth.defaultAccount, gas: 1e6 })
    console.log(`https://kovan.etherscan.io/tx/${receipt.transactionHash}`)

}

main()
