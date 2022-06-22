// Generates Hasher artifact at compile-time using external compilermechanism
const path = require('path')
const fs = require('fs')
const genContract = require('circomlib/src/poseidon_gencontract.js')
const outputPath = path.join(__dirname, '..', 'artifacts', 'contracts')
const outputFile = path.join(outputPath, 'Hasher3.json')

if (!fs.existsSync(outputPath)) {
  fs.mkdirSync(outputPath, { recursive: true })
}

const contract = {
  _format: 'hh-sol-artifact-1',
  sourceName: 'contracts/Hasher.sol',
  linkReferences: {},
  deployedLinkReferences: {},
  contractName: 'Hasher3',
  abi: genContract.generateABI(3),
  bytecode: genContract.createCode(3),
}

fs.writeFileSync(outputFile, JSON.stringify(contract, null, 2))
