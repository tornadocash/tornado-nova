/* eslint-disable no-console */
const MerkleTree = require('fixed-merkle-tree')
const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { toFixedHex, poseidonHash2, getExtDataHash, FIELD_SIZE } = require('./utils')
const Utxo = require('./utxo')

const { prove } = require('./prover')
const MERKLE_TREE_HEIGHT = 5

async function buildMerkleTree({ tornadoPool }) {
  const filter = tornadoPool.filters.NewCommitment()
  const events = await tornadoPool.queryFilter(filter, 0)

  const leaves = events
    .sort((a, b) => a.args.index - b.args.index) // todo sort by event date
    .map((e) => toFixedHex(e.args.commitment))
  // console.log('leaves', leaves)
  return new MerkleTree(MERKLE_TREE_HEIGHT, leaves, { hashFunction: poseidonHash2 })
}

async function getProof({ inputs, outputs, tree, extAmount, fee, recipient, relayer }) {
  // todo shuffle inputs and outputs

  let inputMerklePathIndices = []
  let inputMerklePathElements = []

  for (const input of inputs) {
    if (input.amount > 0) {
      const index = tree.indexOf(toFixedHex(input.getCommitment()))
      if (index < 0) {
        throw new Error(`Input commitment ${toFixedHex(input.getCommitment())} was not found`)
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
  const outputPath = tree.path(outputIndex).pathElements

  const extData = {
    recipient: toFixedHex(recipient, 20),
    relayer: toFixedHex(relayer, 20),
    encryptedOutput1: outputs[0].encrypt(),
    encryptedOutput2: outputs[1].encrypt(),
  }

  const extDataHash = getExtDataHash(extData)
  let input = {
    root: oldRoot,
    newRoot: tree.root(),
    inputNullifier: inputs.map((x) => x.getNullifier()),
    outputCommitment: outputs.map((x) => x.getCommitment()),
    extAmount,
    fee,
    extDataHash,

    // data for 2 transaction inputs
    inAmount: inputs.map((x) => x.amount),
    inPrivateKey: inputs.map((x) => x.keypair.privkey),
    inBlinding: inputs.map((x) => x.blinding),
    inPathIndices: inputMerklePathIndices,
    inPathElements: inputMerklePathElements,

    // data for 2 transaction outputs
    outAmount: outputs.map((x) => x.amount),
    outBlinding: outputs.map((x) => x.blinding),
    outPubkey: outputs.map((x) => x.keypair.pubkey),
    outPathIndices: outputIndex >> Math.log2(outputs.length),
    outPathElements: outputPath.slice(Math.log2(outputs.length)),
  }

  const proof = await prove(input, `./artifacts/circuits/transaction${inputs.length}`)

  const args = [
    toFixedHex(input.root),
    toFixedHex(input.newRoot),
    inputs.map((x) => toFixedHex(x.getNullifier())),
    outputs.map((x) => toFixedHex(x.getCommitment())),
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

async function transaction({ tornadoPool, inputs = [], outputs = [], fee = 0, recipient = 0, relayer = 0 }) {
  if (inputs.length > 16 || outputs.length > 2) {
    throw new Error('Incorrect inputs/outputs count')
  }
  while (inputs.length !== 2 && inputs.length < 16) {
    inputs.push(new Utxo())
  }
  while (outputs.length < 2) {
    outputs.push(new Utxo())
  }

  let extAmount = BigNumber.from(fee)
    .add(outputs.reduce((sum, x) => sum.add(x.amount), BigNumber.from(0)))
    .sub(inputs.reduce((sum, x) => sum.add(x.amount), BigNumber.from(0)))

  const amount = extAmount > 0 ? extAmount : 0 // extAmount will be positive for a deposit, zero for a transact and negative for withdraw
  if (extAmount < 0) {
    extAmount = FIELD_SIZE.add(extAmount)
  }

  const { proof, args } = await getProof({
    inputs,
    outputs,
    tree: await buildMerkleTree({ tornadoPool }),
    extAmount,
    fee,
    recipient,
    relayer,
  })

  const receipt = await tornadoPool.transaction(proof, ...args, {
    value: amount,
    gasLimit: 1e6,
  })
  const { gasUsed } = await receipt.wait()
  // console.log(`Gas Used ${gasUsed}`)
}

module.exports = { transaction }
