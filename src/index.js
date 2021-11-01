/* eslint-disable no-console */
const MerkleTree = require('fixed-merkle-tree')
const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { toFixedHex, poseidonHash2, getExtDataHash, FIELD_SIZE, shuffle } = require('./utils')
const Utxo = require('./utxo')

const { prove } = require('./prover')
const MERKLE_TREE_HEIGHT = 5

async function buildMerkleTree({ tornadoPool }) {
  const filter = tornadoPool.filters.NewCommitment()
  const events = await tornadoPool.queryFilter(filter, 0)

  const leaves = events.sort((a, b) => a.args.index - b.args.index).map((e) => toFixedHex(e.args.commitment))
  return new MerkleTree(MERKLE_TREE_HEIGHT, leaves, { hashFunction: poseidonHash2 })
}

async function getProof({ inputs, outputs, tree, extAmount, fee, recipient, relayer, isL1Withdrawal }) {
  inputs = shuffle(inputs)
  outputs = shuffle(outputs)

  let inputMerklePathIndices = []
  let inputMerklePathElements = []

  for (const input of inputs) {
    if (input.amount > 0) {
      input.index = tree.indexOf(toFixedHex(input.getCommitment()))
      if (input.index < 0) {
        throw new Error(`Input commitment ${toFixedHex(input.getCommitment())} was not found`)
      }
      inputMerklePathIndices.push(input.index)
      inputMerklePathElements.push(tree.path(input.index).pathElements)
    } else {
      inputMerklePathIndices.push(0)
      inputMerklePathElements.push(new Array(tree.levels).fill(0))
    }
  }

  const extData = {
    recipient: toFixedHex(recipient, 20),
    extAmount: toFixedHex(extAmount),
    relayer: toFixedHex(relayer, 20),
    fee: toFixedHex(fee),
    encryptedOutput1: outputs[0].encrypt(),
    encryptedOutput2: outputs[1].encrypt(),
    isL1Withdrawal,
  }

  const extDataHash = getExtDataHash(extData)
  let input = {
    root: tree.root(),
    inputNullifier: inputs.map((x) => x.getNullifier()),
    outputCommitment: outputs.map((x) => x.getCommitment()),
    publicAmount: BigNumber.from(extAmount).sub(fee).add(FIELD_SIZE).mod(FIELD_SIZE).toString(),
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
  }

  const proof = await prove(input, `./artifacts/circuits/transaction${inputs.length}`)

  const args = {
    proof,
    root: toFixedHex(input.root),
    inputNullifiers: inputs.map((x) => toFixedHex(x.getNullifier())),
    outputCommitments: outputs.map((x) => toFixedHex(x.getCommitment())),
    publicAmount: toFixedHex(input.publicAmount),
    extDataHash: toFixedHex(extDataHash),
  }
  // console.log('Solidity args', args)

  return {
    extData,
    args,
  }
}

async function prepareTransaction({
  tornadoPool,
  inputs = [],
  outputs = [],
  fee = 0,
  recipient = 0,
  relayer = 0,
  isL1Withdrawal = false,
}) {
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

  const { args, extData } = await getProof({
    inputs,
    outputs,
    tree: await buildMerkleTree({ tornadoPool }),
    extAmount,
    fee,
    recipient,
    relayer,
    isL1Withdrawal,
  })

  return {
    args,
    extData,
  }
}

async function transaction({ tornadoPool, ...rest }) {
  const { args, extData } = await prepareTransaction({
    tornadoPool,
    ...rest,
  })

  const receipt = await tornadoPool.transact(args, extData, {
    gasLimit: 2e6,
  })
  return await receipt.wait()
}

async function registerAndTransact({ tornadoPool, account, ...rest }) {
  const { args, extData } = await prepareTransaction({
    tornadoPool,
    ...rest,
  })

  const receipt = await tornadoPool.registerAndTransact(account, args, extData, {
    gasLimit: 2e6,
  })
  await receipt.wait()
}

module.exports = { transaction, registerAndTransact, prepareTransaction, buildMerkleTree }
