// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import { IERC6777 } from "../interfaces/IBridge.sol";

contract WithdrawalWorkerStuckCheck {
  constructor(
    IERC6777 token,
    address changeReceiver,
    address[] memory targets,
    bytes[] memory calldatas
  ) {
    for (uint256 i = 0; i < targets.length; i++) {
      (bool success, ) = targets[i].call(calldatas[i]);
      require(success, "WW: call failed");
    }
    uint256 amount = token.balanceOf(address(this));
    token.transfer(changeReceiver, amount);
    assembly {
      return(0, 0)
    }
  }
}
