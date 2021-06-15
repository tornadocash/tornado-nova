/* eslint-disable no-console */
const MerkleTree = require('fixed-merkle-tree')
const { ethers } = require('hardhat')
const { toFixedHex, poseidonHash2, getExtDataHash, FIELD_SIZE, packEncryptedMessage } = require('./utils')
const Utxo = require('./utxo')

const { prove } = require('./prover')
const MERKLE_TREE_HEIGHT = 5

async function buildMerkleTree({ tornadoPool }) {
  console.log('Getting contract state...')
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

  //encrypt(encryptedPublicKey, { data }, 'x25519-xsalsa20-poly1305')

  const extData = {
    recipient: toFixedHex(recipient, 20),
    relayer: toFixedHex(relayer, 20),
    encryptedOutput1: packEncryptedMessage(
      outputs[0].keypair.encrypt({ blinding: outputs[0].blinding, amount: outputs[0].amount }),
    ),
    encryptedOutput2: packEncryptedMessage(
      outputs[1].keypair.encrypt({ blinding: outputs[1].blinding, amount: outputs[1].amount }),
    ),
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

  //console.log('SNARK input', input)

  console.log('Generating SNARK proof...')
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

async function deposit({ tornadoPool, utxo }) {
  const inputs = [new Utxo(), new Utxo()]
  const outputs = [utxo, new Utxo()]

  const { proof, args } = await getProof({
    inputs,
    outputs,
    tree: await buildMerkleTree({ tornadoPool }),
    extAmount: utxo.amount,
    fee: 0,
    recipient: 0,
    relayer: 0,
  })

  console.log('Sending deposit transaction...')
  const receipt = await tornadoPool.transaction(proof, ...args, {
    value: utxo.amount,
    gasLimit: 1e6,
  })
  console.log(`Receipt ${receipt.hash}`)
  return outputs[0]
}

async function merge({ tornadoPool }) {
  const amount = 1e6
  const inputs = new Array(16).fill(0).map((_) => new Utxo())
  const outputs = [new Utxo({ amount }), new Utxo()]

  const { proof, args } = await getProof({
    inputs,
    outputs,
    tree: await buildMerkleTree({ tornadoPool }),
    extAmount: amount,
    fee: 0,
    recipient: 0,
    relayer: 0,
  })

  const receipt = await tornadoPool.transaction(proof, ...args, {
    value: amount,
    gasLimit: 1e6,
  })
  console.log(`Receipt ${receipt.hash}`)
  return outputs[0]
}

async function transact({ tornadoPool, input, output }) {
  const inputs = [input, new Utxo()]
  const outputs = [output, new Utxo()]

  const { proof, args } = await getProof({
    inputs,
    outputs,
    tree: await buildMerkleTree({ tornadoPool }),
    extAmount: 0,
    fee: 0,
    recipient: 0,
    relayer: 0,
  })

  console.log('Sending transfer transaction...')
  const receipt = await tornadoPool.transaction(proof, ...args, { gasLimit: 1e6 })
  console.log(`Receipt ${receipt.hash}`)
  return outputs[0]
}

async function withdraw({ tornadoPool, input, change, recipient }) {
  const inputs = [input, new Utxo()]
  const outputs = [change, new Utxo()]

  const { proof, args } = await getProof({
    inputs,
    outputs,
    tree: await buildMerkleTree({ tornadoPool }),
    extAmount: FIELD_SIZE.sub(input.amount.sub(change.amount)),
    fee: 0,
    recipient,
    relayer: 0,
  })

  console.log('Sending withdraw transaction...')
  const receipt = await tornadoPool.transaction(proof, ...args, { gasLimit: 1e6 })
  console.log(`Receipt ${receipt.hash}`)
}

module.exports = { deposit, withdraw, transact, merge }
