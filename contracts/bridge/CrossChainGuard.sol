// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import { IAMB } from "../interfaces/IBridge.sol";

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
