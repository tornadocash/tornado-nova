const MerkleTree = require('../lib/merkleTree')
const fs = require('fs')
const { bigInt, stringifyBigInts } = require('snarkjs')
const crypto = require('crypto')
const Hasher = require('../lib/mimc')
const Web3 = require('web3')
const buildGroth16 = require('websnark/src/groth16')
const websnarkUtils = require('websnark/src/utils')

let contract, web3, circuit, proving_key, groth16
const hasher = new Hasher()

// console.log(hasher.hashArray(['21663839004416932945382355908790599225266501822907911457504978515578255421292', '21663839004416932945382355908790599225266501822907911457504978515578255421292']))

const MERKLE_TREE_HEIGHT = 5
const RPC_URL = 'http://localhost:8545'

/** Generate random number of specified byte length */
const rbigint = (nbytes = 31) => bigInt.leBuff2int(crypto.randomBytes(nbytes))

/** BigNumber to hex string of specified length */
const toHex = (number, length = 32) => '0x' + (number instanceof Buffer ? number.toString('hex') : bigInt(number).toString(16)).padStart(length * 2, '0')


function merklePathIndicesToBigint(indexArray) {
  let result = 0
  for(let item of indexArray) {
    result = (result << 1) + item
  }
  return result
}

function fromPrivkey(privkey) {
    return {
        privkey,
        pubkey: hasher.hashArray([privkey]),
    }
}

function randomKeypair() {
    return fromPrivkey(rbigint())
}

function createZeroUtxo(keypair) {
  return createUtxo(
      0,
      rbigint(),
      keypair.pubkey,
      keypair.privkey,
      Array(MERKLE_TREE_HEIGHT).fill(0),
      Array(MERKLE_TREE_HEIGHT).fill(0)
  )
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
    utxo.commitment = hasher.hashArray([amount, blinding, pubkey])
    if (privkey) {
        utxo.nullifier = hasher.hashArray([utxo.commitment, merklePathIndicesToBigint(merklePathIndices), privkey])
    }
    return utxo
}

function createDeposit(amount, pubkey) {
    const keypair = randomKeypair()
    const tx = {
        inputs: [createZeroUtxo(keypair), createZeroUtxo(keypair)],
        outputs: [createOutput(amount, pubkey), createZeroUtxo(keypair)], // todo shuffle
    }
    return tx;
}

async function buildMerkleTree() {
    console.log('Getting contract state...')
    const events = await contract.getPastEvents('NewCommitment', { fromBlock: 0, toBlock: 'latest' })
    const leaves = events
      .sort((a, b) => a.returnValues.index - b.returnValues.index) // todo sort by event date
      .map(e => e.returnValues.commitment)
    return new MerkleTree(MERKLE_TREE_HEIGHT, leaves)
}

async function insertOutput(tree, output) {
    await tree.insert(output.commitment)
    let { path_elements, path_index } = await tree.path(tree.totalElements - 1)
    output.merklePathIndices = path_index
    output.merklePathElements = path_elements
}

async function main() {
    web3 = new Web3(new Web3.providers.HttpProvider(RPC_URL, { timeout: 5 * 60 * 1000 }), null, { transactionConfirmationBlocks: 1 })
    circuit = require('../build/circuits/transaction.json')
    proving_key = fs.readFileSync('../build/circuits/transaction_proving_key.bin').buffer
    groth16 = await buildGroth16()
    netId = await web3.eth.net.getId()
    const contractData = require('../build/contracts/TornadoPool.json')
    contract = new web3.eth.Contract(contractData.abi, contractData.networks[netId].address)
    web3.eth.defaultAccount = (await web3.eth.getAccounts())[0]

    const amount = 1e6;
    const tree = await buildMerkleTree()
    const oldRoot = await tree.root()
    const keypair = randomKeypair()
    const tx = createDeposit(amount, keypair.pubkey)
    await insertOutput(tree, tx.outputs[0])
    await insertOutput(tree, tx.outputs[1])
    console.log('Note', tx.outputs[0])

    let input = {
        root: oldRoot,
        newRoot: await tree.root(),
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
        outPubkey: [tx.outputs[0].pubkey, tx.outputs[1].pubkey],
        outPathIndices: merklePathIndicesToBigint(tx.outputs[0].merklePathIndices.slice(1)),
        outPathElements: tx.outputs[0].merklePathElements.slice(1)
    }

    console.log('input', JSON.stringify(stringifyBigInts(input)))

    console.log('Generating SNARK proof...')
    const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
    const { proof } = websnarkUtils.toSolidityInput(proofData)

    const args = [
        toHex(input.root),
        toHex(input.newRoot),
        [toHex(tx.inputs[0].nullifier), toHex(tx.inputs[1].nullifier)],
        [toHex(tx.outputs[0].commitment), toHex(tx.outputs[1].commitment)],
        toHex(amount),
        toHex(input.fee),
        toHex(input.recipient, 20),
        toHex(input.relayer, 20),
    ]

    console.log('Sending deposit transaction...')
    const receipt = await contract.methods.transaction(proof, ...args).send({ value: amount, from: web3.eth.defaultAccount, gas: 1e6 })
    console.log(`Receipt ${receipt.transactionHash}`)

}

main()
