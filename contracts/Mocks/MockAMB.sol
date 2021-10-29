// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;
pragma abicoder v2;

import { IAMB } from "../interfaces/IBridge.sol";

contract MockAMB is IAMB {
  address public xDomainMessageSender;
  bytes32 public xDomainMessageChainId;

  struct Call {
    address who;
    bytes callData;
  }

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

  function execute(Call[] calldata _calls) external returns (bool success, bytes memory result) {
    for (uint256 i = 0; i < _calls.length; i++) {
      (success, result) = _calls[i].who.call(_calls[i].callData);
      require(success, string(result));
    }
  }
}
