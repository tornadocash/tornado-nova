/* eslint-disable no-console */
const MerkleTree = require('fixed-merkle-tree')
const fs = require('fs')
const crypto = require('crypto')
const { poseidon } = require('circomlib')
const Web3 = require('web3')
const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { randomBN, bitsToNumber, toFixedHex, toBuffer, poseidonHash, poseidonHash2 } = require('./utils')

let contract, web3
const { prove } = require('./prover')
const FIELD_SIZE = '21888242871839275222246405745257275088548364400416034343698204186575808495617'
const MERKLE_TREE_HEIGHT = 5
const RPC_URL = 'http://localhost:8545'

function fromPrivkey(privkey) {
  return {
    privkey,
    pubkey: poseidonHash([privkey]),
  }
}

function randomKeypair() {
  return fromPrivkey(randomBN())
}

function createZeroUtxo(keypair) {
  return createUtxo(
    0,
    randomBN(),
    keypair.pubkey,
    keypair.privkey,
    Array(MERKLE_TREE_HEIGHT).fill(0),
    Array(MERKLE_TREE_HEIGHT).fill(0),
  )
}

function createOutput(amount, pubkey) {
  if (!pubkey) {
    throw new Error('no pubkey')
  }
  return createUtxo(amount, randomBN(), pubkey)
}

function createInput({ amount, blinding, pubkey, privkey, merklePathIndices, merklePathElements }) {
  return createUtxo(amount, blinding, pubkey, privkey, merklePathIndices, merklePathElements)
}

/// unsafe function without sanity checks
function createUtxo(amount, blinding, pubkey, privkey, merklePathIndices, merklePathElements) {
  let utxo = { amount, blinding, pubkey, privkey, merklePathIndices, merklePathElements }
  utxo.commitment = poseidonHash([amount, blinding, pubkey])
  if (privkey) {
    utxo.nullifier = poseidonHash([utxo.commitment, bitsToNumber(merklePathIndices), privkey])
  }
  return utxo
}

function createDeposit(amount, keypair) {
  const fakeKeypair = randomKeypair()
  const output = createOutput(amount, keypair.pubkey)
  output.privkey = keypair.privkey
  const tx = {
    inputs: [createZeroUtxo(fakeKeypair), createZeroUtxo(fakeKeypair)],
    outputs: [output, createZeroUtxo(fakeKeypair)], // todo shuffle
  }
  return tx
}

async function buildMerkleTree() {
  console.log('Getting contract state...')
  const events = await contract.getPastEvents('NewCommitment', { fromBlock: 0, toBlock: 'latest' })
  const leaves = events
    .sort((a, b) => a.returnValues.index - b.returnValues.index) // todo sort by event date
    .map((e) => toFixedHex(e.returnValues.commitment))
  console.log('leaves', leaves)
  return new MerkleTree(MERKLE_TREE_HEIGHT, leaves, { hashFunction: poseidonHash2 })
}

async function insertOutput(tree, output) {
  await tree.insert(output.commitment)
  let { pathElements, pathIndices } = await tree.path(tree.elements().length - 1)
  output.merklePathIndices = pathIndices
  output.merklePathElements = pathElements
}

async function deposit() {
  const amount = 1e6
  const tree = await buildMerkleTree()
  const oldRoot = await tree.root()
  const keypair = randomKeypair()
  const tx = createDeposit(amount, keypair)
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
    inPathIndices: [
      bitsToNumber(tx.inputs[0].merklePathIndices),
      bitsToNumber(tx.inputs[1].merklePathIndices),
    ],
    inPathElements: [tx.inputs[0].merklePathElements, tx.inputs[1].merklePathElements],

    // data for 2 transaction outputs
    outAmount: [tx.outputs[0].amount, tx.outputs[1].amount],
    outBlinding: [tx.outputs[0].blinding, tx.outputs[1].blinding],
    outPubkey: [tx.outputs[0].pubkey, tx.outputs[1].pubkey],
    outPathIndices: bitsToNumber(tx.outputs[0].merklePathIndices.slice(1)),
    outPathElements: tx.outputs[0].merklePathElements.slice(1),
  }

  // console.log('input', JSON.stringify(stringifyBigInts(input)))
  console.log('DEPOSIT input', input)

  console.log('Generating SNARK proof...')

  const proof = await prove(input, './artifacts/circuits/transaction')

  const args = [
    toFixedHex(input.root),
    toFixedHex(input.newRoot),
    [toFixedHex(tx.inputs[0].nullifier), toFixedHex(tx.inputs[1].nullifier)],
    [toFixedHex(tx.outputs[0].commitment), toFixedHex(tx.outputs[1].commitment)],
    toFixedHex(amount),
    toFixedHex(input.fee),
    toFixedHex(input.recipient, 20),
    toFixedHex(input.relayer, 20),
  ]

  console.log('Sending deposit transaction...')
  const receipt = await contract.methods
    .transaction(proof, ...args)
    .send({ value: amount, from: web3.eth.defaultAccount, gas: 1e6 })
  console.log(`Receipt ${receipt.transactionHash}`)
  return tx.outputs[0]
}

async function transact(txOutput) {
  console.log('txOutput', txOutput)
  const tree = await buildMerkleTree()
  console.log('tree', tree)
  const oldRoot = await tree.root()
  const keypair = randomKeypair()

  const index = await tree.indexOf(toFixedHex(txOutput.commitment))
  console.log('index', index)
  const { pathElements, pathIndices } = await tree.path(index)
  console.log('pathIndices', pathIndices)
  txOutput.merklePathElements = pathElements
  const input1 = createInput(txOutput)
  const tx = {
    inputs: [input1, createZeroUtxo(fromPrivkey(txOutput.privkey))],
    outputs: [
      createOutput(txOutput.amount / 4, keypair.pubkey),
      createOutput((txOutput.amount * 3) / 4, txOutput.pubkey),
    ], // todo shuffle
  }
  tx.outputs[0].privkey = keypair.privkey
  tx.outputs[1].privkey = txOutput.privkey
  await insertOutput(tree, tx.outputs[0])
  await insertOutput(tree, tx.outputs[1])
  console.log('Note', tx.outputs[0])

  let input = {
    root: oldRoot,
    newRoot: await tree.root(),
    inputNullifier: [tx.inputs[0].nullifier, tx.inputs[1].nullifier],
    outputCommitment: [tx.outputs[0].commitment, tx.outputs[1].commitment],
    extAmount: 0,
    fee: 0,
    recipient: 0,
    relayer: 0,

    // private inputs
    privateKey: tx.inputs[0].privkey,

    // data for 2 transaction inputs
    inAmount: [tx.inputs[0].amount, tx.inputs[1].amount],
    inBlinding: [tx.inputs[0].blinding, tx.inputs[1].blinding],
    inPathIndices: [
      bitsToNumber(tx.inputs[0].merklePathIndices),
      bitsToNumber(tx.inputs[1].merklePathIndices),
    ],
    inPathElements: [tx.inputs[0].merklePathElements, tx.inputs[1].merklePathElements],

    // data for 2 transaction outputs
    outAmount: [tx.outputs[0].amount, tx.outputs[1].amount],
    outBlinding: [tx.outputs[0].blinding, tx.outputs[1].blinding],
    outPubkey: [tx.outputs[0].pubkey, tx.outputs[1].pubkey],
    outPathIndices: bitsToNumber(tx.outputs[0].merklePathIndices.slice(1)),
    outPathElements: tx.outputs[0].merklePathElements.slice(1),
  }

  console.log('TRANSFER input', input)

  console.log('Generating SNARK proof...')
  const proof = await prove(input, './artifacts/circuits/transaction')

  const args = [
    toFixedHex(input.root),
    toFixedHex(input.newRoot),
    [toFixedHex(tx.inputs[0].nullifier), toFixedHex(tx.inputs[1].nullifier)],
    [toFixedHex(tx.outputs[0].commitment), toFixedHex(tx.outputs[1].commitment)],
    toFixedHex(0),
    toFixedHex(input.fee),
    toFixedHex(input.recipient, 20),
    toFixedHex(input.relayer, 20),
  ]

  console.log('Sending transfer transaction...')
  const receipt = await contract.methods
    .transaction(proof, ...args)
    .send({ from: web3.eth.defaultAccount, gas: 1e6 })
  console.log(`Receipt ${receipt.transactionHash}`)
  return tx.outputs[0]
}

async function withdraw(txOutput) {
  console.log('txOutput', txOutput)
  const tree = await buildMerkleTree()
  const oldRoot = await tree.root()

  const index = await tree.indexOf(toFixedHex(txOutput.commitment))
  console.log('index', index)
  const { pathElements, pathIndices } = await tree.path(index)
  console.log('pathIndices', pathIndices)
  txOutput.merklePathElements = pathElements
  const input1 = createInput(txOutput)
  const fakeKeypair = randomKeypair()
  const tx = {
    inputs: [input1, createZeroUtxo(fromPrivkey(txOutput.privkey))],
    outputs: [createZeroUtxo(fakeKeypair), createZeroUtxo(fakeKeypair)], // todo shuffle
  }
  await insertOutput(tree, tx.outputs[0])
  await insertOutput(tree, tx.outputs[1])

  let input = {
    root: oldRoot,
    newRoot: await tree.root(),
    inputNullifier: [tx.inputs[0].nullifier, tx.inputs[1].nullifier],
    outputCommitment: [tx.outputs[0].commitment, tx.outputs[1].commitment],
    extAmount: BigNumber.from(FIELD_SIZE).sub(BigNumber.from(txOutput.amount)),
    fee: 0,
    recipient: '0xc2Ba33d4c0d2A92fb4f1a07C273c5d21E688Eb48',
    relayer: 0,

    // private inputs
    privateKey: tx.inputs[0].privkey,

    // data for 2 transaction inputs
    inAmount: [tx.inputs[0].amount, tx.inputs[1].amount],
    inBlinding: [tx.inputs[0].blinding, tx.inputs[1].blinding],
    inPathIndices: [
      bitsToNumber(tx.inputs[0].merklePathIndices),
      bitsToNumber(tx.inputs[1].merklePathIndices),
    ],
    inPathElements: [tx.inputs[0].merklePathElements, tx.inputs[1].merklePathElements],

    // data for 2 transaction outputs
    outAmount: [tx.outputs[0].amount, tx.outputs[1].amount],
    outBlinding: [tx.outputs[0].blinding, tx.outputs[1].blinding],
    outPubkey: [tx.outputs[0].pubkey, tx.outputs[1].pubkey],
    outPathIndices: bitsToNumber(tx.outputs[0].merklePathIndices.slice(1)),
    outPathElements: tx.outputs[0].merklePathElements.slice(1),
  }

  console.log('WITHDRAW input', input)

  console.log('Generating SNARK proof...')
  const proof = await prove(input, './artifacts/circuits/transaction')

  const args = [
    toFixedHex(input.root),
    toFixedHex(input.newRoot),
    [toFixedHex(tx.inputs[0].nullifier), toFixedHex(tx.inputs[1].nullifier)],
    [toFixedHex(tx.outputs[0].commitment), toFixedHex(tx.outputs[1].commitment)],
    toFixedHex(input.extAmount),
    toFixedHex(input.fee),
    toFixedHex(input.recipient, 20),
    toFixedHex(input.relayer, 20),
  ]

  console.log('args', args)

  console.log('Sending withdraw transaction...')
  const receipt = await contract.methods
    .transaction(proof, ...args)
    .send({ from: web3.eth.defaultAccount, gas: 1e6 })
  console.log(`Receipt ${receipt.transactionHash}`)

  let bal = await web3.eth.getBalance('0xc2Ba33d4c0d2A92fb4f1a07C273c5d21E688Eb48')
  console.log('balance', bal)
}

async function main() {
  web3 = new Web3(new Web3.providers.HttpProvider(RPC_URL, { timeout: 5 * 60 * 1000 }), null, {
    transactionConfirmationBlocks: 1,
  })
  netId = await web3.eth.net.getId()
  const contractData = require('../artifacts/contracts/TornadoPool.sol/TornadoPool.json')
  contract = new web3.eth.Contract(contractData.abi, '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9')
  web3.eth.defaultAccount = (await web3.eth.getAccounts())[0]

  const txOutput = await deposit()
  const txOutput1 = await transact(txOutput)
  await withdraw(txOutput1)
}

main()
