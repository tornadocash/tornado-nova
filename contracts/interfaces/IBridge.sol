// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// https://docs.tokenbridge.net/amb-bridge/development-of-a-cross-chain-application/how-to-develop-xchain-apps-by-amb#call-a-method-in-another-chain-using-the-amb-bridge
interface IAMB {
  function messageSender() external view returns (address);

  function messageSourceChainId() external view returns (bytes32);
}

interface IOmniBridge {
  function bridgeContract() external view returns (IAMB);
}

interface IERC6777 is IERC20 {
  function transferAndCall(
    address,
    uint256,
    bytes calldata
  ) external returns (bool);
}

interface IERC20Receiver {
  function onTokenBridged(
    IERC6777 token,
    uint256 value,
    bytes calldata data
  ) external;
}
