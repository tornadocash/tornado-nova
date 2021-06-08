const crypto = require('crypto')
const ethers = require('ethers')
const BigNumber = ethers.BigNumber
const {poseidon} = require('circomlib')

const poseidonHash = (items) => BigNumber.from(poseidon(items).toString())
const poseidonHash2 = (a, b) => poseidonHash([a, b])

const FIELD_SIZE = BigNumber.from(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
)
/** Generate random number of specified byte length */
const randomBN = (nbytes = 31) => BigNumber.from(crypto.randomBytes(nbytes))

function getExtDataHash({recipient, relayer, encryptedOutput1, encryptedOutput2}) {
  const abi = new ethers.utils.AbiCoder()

  const encodedData = abi.encode(
    ['tuple(address recipient,address relayer,bytes encryptedOutput1,bytes encryptedOutput2)'],
    [{
        recipient: toFixedHex(recipient, 20),
        relayer: toFixedHex(relayer, 20),
        encryptedOutput1: encryptedOutput1,
        encryptedOutput2: encryptedOutput2,
      }],
  )
  const hash = ethers.utils.keccak256(encodedData)
  return BigNumber.from(hash).mod(FIELD_SIZE)
}

/** BigNumber to hex string of specified length */
const toFixedHex = (number, length = 32) =>
  '0x' +
  (number instanceof Buffer
      ? number.toString('hex')
      : BigNumber.from(number).toHexString().slice(2)
  ).padStart(length * 2, '0')

const toBuffer = (value, length) =>
  Buffer.from(
    BigNumber.from(value)
      .toHexString()
      .slice(2)
      .padStart(length * 2, '0'),
    'hex',
  )

module.exports = {
  FIELD_SIZE,
  randomBN,
  toFixedHex,
  toBuffer,
  poseidonHash,
  poseidonHash2,
  getExtDataHash,
}
