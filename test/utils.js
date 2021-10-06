const { ethers } = require('hardhat')

const abi = new ethers.utils.AbiCoder()

function encodeDataForBridge({ proof, extData }) {
  return abi.encode(
    [
      'tuple(bytes proof,bytes32 root,bytes32[] inputNullifiers,bytes32[2] outputCommitments,uint256 publicAmount,bytes32 extDataHash)',
      'tuple(address recipient,int256 extAmount,address relayer,uint256 fee,bytes encryptedOutput1,bytes encryptedOutput2,bool isL1Withdrawal)',
    ],
    [proof, extData],
  )
}

module.exports = { encodeDataForBridge }
