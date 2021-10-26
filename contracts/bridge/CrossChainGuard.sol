// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import { IAMB } from "../interfaces/IBridge.sol";

/** @dev Special cross chain guard that can authorize caller as owner of this contract according to XDAI AMB bridge protocol.
 * more info here https://docs.tokenbridge.net/amb-bridge/development-of-a-cross-chain-application/how-to-develop-xchain-apps-by-amb#receive-a-method-call-from-the-amb-bridge
 */
contract CrossChainGuard {
  IAMB public immutable ambBridge;
  bytes32 public immutable ownerChainId;
  address public immutable owner;

  constructor(
    address _ambBridge,
    uint256 _ownerChainId,
    address _owner
  ) {
    ambBridge = IAMB(_ambBridge);
    owner = _owner;
    ownerChainId = bytes32(uint256(_ownerChainId));
  }

  function isCalledByOwner() public virtual returns (bool) {
    return
      msg.sender == address(ambBridge) && ambBridge.messageSourceChainId() == ownerChainId && ambBridge.messageSender() == owner;
  }
}
