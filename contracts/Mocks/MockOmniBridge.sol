// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import { IAMB, IOmniBridge } from "../CrossChainUpgradeableProxy.sol";

contract MockOmniBridge is IOmniBridge {
  IAMB public AMB;

  constructor(IAMB _AMB) {
    AMB = _AMB;
  }

  function bridgeContract() external view override returns (IAMB) {
    return AMB;
  }

  function execute(address _who, bytes calldata _calldata) external returns (bool success, bytes memory result) {
    (success, result) = _who.call(_calldata);
  }
}
