// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import { IAMB } from "../CrossChainUpgradeableProxy.sol";

contract MockAMB is IAMB {
  address public xDomainMessageSender;

  constructor(address _xDomainMessageSender) {
    xDomainMessageSender = _xDomainMessageSender;
  }

  function setMessageSender(address _sender) external {
    xDomainMessageSender = _sender;
  }

  function messageSender() external view override returns (address) {
    return xDomainMessageSender;
  }
}
