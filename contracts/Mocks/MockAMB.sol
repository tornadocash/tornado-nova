// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import { IAMB } from "../CrossChainUpgradeableProxy.sol";

contract MockAMB is IAMB {
  address public xDomainMessageSender;
  bytes32 public xDomainMessageChainId;

  constructor(address _xDomainMessageSender, uint256 _xDomainMessageChainId) {
    xDomainMessageSender = _xDomainMessageSender;
    xDomainMessageChainId = bytes32(uint256(_xDomainMessageChainId));
  }

  function setMessageSender(address _sender) external {
    xDomainMessageSender = _sender;
  }

  function messageSender() external view override returns (address) {
    return xDomainMessageSender;
  }

  function messageSourceChainId() external view override returns (bytes32) {
    return xDomainMessageChainId;
  }

  function execute(address _who, bytes calldata _calldata) external returns (bool success, bytes memory result) {
    (success, result) = _who.call(_calldata);
    require(success, string(result));
  }
}
