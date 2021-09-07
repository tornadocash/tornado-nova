// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

contract MockOVM_CrossDomainMessenger {
  address public xDomainMessageSender;

  constructor(address _xDomainMessageSender) {
    xDomainMessageSender = _xDomainMessageSender;
  }

  function execute(address _who, bytes calldata _calldata) external returns (bool success, bytes memory result) {
    (success, result) = _who.call(_calldata);
  }
}
