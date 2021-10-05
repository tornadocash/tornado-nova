// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

// https://docs.tokenbridge.net/amb-bridge/development-of-a-cross-chain-application/how-to-develop-xchain-apps-by-amb#call-a-method-in-another-chain-using-the-amb-bridge
interface IAMB {
  function messageSender() external view returns (address);

  function messageSourceChainId() external view returns (bytes32);
}

interface IOmniBridge {
  function bridgeContract() external view returns (IAMB);
}
