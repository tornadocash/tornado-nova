/* eslint-disable no-console */
const MerkleTree = require('fixed-merkle-tree')
const Web3 = require('web3')
const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { toFixedHex, poseidonHash2, getExtDataHash, FIELD_SIZE } = require('./utils')
const Utxo = require('./utxo')

let contract, web3
const { prove } = require('./prover')
const MERKLE_TREE_HEIGHT = 5
const RPC_URL = 'http://localhost:8545'

async function buildMerkleTree() {
  console.log('Getting contract state...')
  const events = await contract.getPastEvents('NewCommitment', { fromBlock: 0, toBlock: 'latest' })
  const leaves = events
    .sort((a, b) => a.returnValues.index - b.returnValues.index) // todo sort by event date
    .map((e) => toFixedHex(e.returnValues.commitment))
  // console.log('leaves', leaves)
  return new MerkleTree(MERKLE_TREE_HEIGHT, leaves, { hashFunction: poseidonHash2 })
}

async function getProof({ inputs, outputs, tree, extAmount, fee, recipient, relayer }) {
  // todo shuffle inputs and outputs
  if (inputs.length !== 2 || outputs.length !== 2 ) {
    throw new Error('Unsupported number of inputs/outputs')
  }

  let inputMerklePathIndices = []
  let inputMerklePathElements = []

  for (const input of inputs) {
    if (input.amount > 0) {
      const index = tree.indexOf(toFixedHex(input.getCommitment()))
      if (index < 0) {
        throw new Error(`Input commitment ${input.getCommitment()} was not found`)
      }
      inputMerklePathIndices.push(index)
      inputMerklePathElements.push(tree.path(index).pathElements)
    } else {
      inputMerklePathIndices.push(0)
      inputMerklePathElements.push(new Array(tree.levels).fill(0))
    }
  }

  const oldRoot = tree.root()
  for (const output of outputs) {
    output.index = tree.elements().length
    tree.insert(output.getCommitment())
  }
  const outputIndex = tree.elements().length - 1
  const outputPath = tree.path(outputIndex).pathElements.slice(1)

  const extData = {
    recipient: toFixedHex(recipient, 20),
    relayer: toFixedHex(relayer, 20),
    encryptedOutput1: '0xff',
    encryptedOutput2: '0xff',
  }

  const extDataHash = getExtDataHash(extData)
  let input = {
    root: oldRoot,
    newRoot: tree.root(),
    inputNullifier: inputs.map(x => x.getNullifier()),
    outputCommitment: outputs.map(x => x.getCommitment()),
    extAmount,
    fee,
    extDataHash,

    // data for 2 transaction inputs
    inAmount: inputs.map(x => x.amount),
    inPrivateKey: inputs.map(x => x.privkey),
    inBlinding: inputs.map(x => x.blinding),
    inPathIndices: inputMerklePathIndices,
    inPathElements: inputMerklePathElements,

    // data for 2 transaction outputs
    outAmount: outputs.map(x => x.amount),
    outBlinding: outputs.map(x => x.blinding),
    outPubkey: outputs.map(x => x.pubkey),
    outPathIndices: outputIndex >> 1,
    outPathElements: outputPath,
  }

  //console.log('SNARK input', input)

  console.log('Generating SNARK proof...')
  const proof = await prove(input, './artifacts/circuits/transaction')

  const args = [
    toFixedHex(input.root),
    toFixedHex(input.newRoot),
    inputs.map(x => toFixedHex(x.getNullifier())),
    outputs.map(x => toFixedHex(x.getCommitment())),
    toFixedHex(extAmount),
    toFixedHex(fee),
    extData,
    toFixedHex(extDataHash),
  ]
  // console.log('Solidity args', args)

  return {
    proof,
    args,
  }
}

async function deposit() {
  const amount = 1e6
  const inputs = [new Utxo(), new Utxo()]
  const outputs = [new Utxo({ amount }), new Utxo()]

  const { proof, args } = await getProof({
    inputs,
    outputs,
    tree: await buildMerkleTree(),
    extAmount: amount,
    fee: 0,
    recipient: 0,
    relayer: 0,
  })

  console.log('Sending deposit transaction...')
  const receipt = await contract.methods
    .transaction(proof, ...args)
    .send({ value: amount, from: web3.eth.defaultAccount, gas: 1e6 })
  console.log(`Receipt ${receipt.transactionHash}`)
  return outputs[0]
}

async function transact(utxo) {
  const inputs = [utxo, new Utxo()]
  const outputs = [
    new Utxo({ amount: utxo.amount / 4 }),
    new Utxo({ amount: utxo.amount * 3 / 4, privkey: utxo.privkey}),
  ]

  const { proof, args } = await getProof({
    inputs,
    outputs,
    tree: await buildMerkleTree(),
    extAmount: 0,
    fee: 0,
    recipient: 0,
    relayer: 0,
  })

  console.log('Sending transfer transaction...')
  const receipt = await contract.methods
    .transaction(proof, ...args)
    .send({ from: web3.eth.defaultAccount, gas: 1e6 })
  console.log(`Receipt ${receipt.transactionHash}`)
  return outputs[0]
}

async function withdraw(utxo) {
  const inputs = [utxo, new Utxo()]
  const outputs = [new Utxo(), new Utxo()]

  const { proof, args } = await getProof({
    inputs,
    outputs,
    tree: await buildMerkleTree(),
    extAmount: FIELD_SIZE.sub(utxo.amount),
    fee: 0,
    recipient: '0xc2Ba33d4c0d2A92fb4f1a07C273c5d21E688Eb48',
    relayer: 0,
  })

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
  contract = new web3.eth.Contract(contractData.abi, '0x0E801D84Fa97b50751Dbf25036d067dCf18858bF')
  web3.eth.defaultAccount = (await web3.eth.getAccounts())[0]

  const utxo1 = await deposit()
  const utxo2 = await transact(utxo1)
  await withdraw(utxo2)
}

main()
