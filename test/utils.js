const { ethers } = require('hardhat')

const abi = new ethers.utils.AbiCoder()

function encodeDataForBridge({ account, proof, extData, signature }) {
  return abi.encode(
    [
      'tuple(address owner,bytes publicKey)',
      'tuple(bytes proof,bytes32 root,bytes32[] inputNullifiers,bytes32[2] outputCommitments,uint256 publicAmount,bytes32 extDataHash)',
      'tuple(address recipient,int256 extAmount,address relayer,uint256 fee,bytes encryptedOutput1,bytes encryptedOutput2,bool isL1Withdrawal)',
      'bytes',
    ],
    [account, proof, extData, signature],
  )
}

function EIP721Params({ chainId, verifyingContract, owner, publicKey }) {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      TornadoAccount: [
        { name: 'owner', type: 'address' },
        { name: 'publicKey', type: 'bytes' },
      ],
    },
    primaryType: 'TornadoAccount',
    domain: {
      name: 'TornadoPool',
      version: '1',
      chainId,
      verifyingContract,
    },
    message: {
      owner,
      publicKey,
    },
  }
}

module.exports = { encodeDataForBridge, EIP721Params }
