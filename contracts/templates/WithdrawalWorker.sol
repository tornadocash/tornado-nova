// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import { IERC6777 } from "../interfaces/IBridge.sol";

contract WithdrawalWorker {
  constructor(
    IERC6777 token,
    address[] memory targets,
    bytes[] memory calldatas
  ) {
    for (uint256 i = 0; i < targets.length; i++) {
      (bool success, ) = targets[i].call(calldatas[i]);
      require(success, "WW: call failed");
    }
    require(token.balanceOf(address(this)) == 0, "Stuck tokens on withdrawal worker");
    assembly {
      return(0, 0)
    }
  }
}
