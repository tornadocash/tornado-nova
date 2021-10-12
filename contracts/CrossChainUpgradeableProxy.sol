// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import { CrossChainGuard } from "./bridge/CrossChainGuard.sol";
import "@openzeppelin/contracts/proxy/TransparentUpgradeableProxy.sol";

/**
 * @dev TransparentUpgradeableProxy where admin acts from a different chain.
 */
contract CrossChainUpgradeableProxy is TransparentUpgradeableProxy, CrossChainGuard {
  /**
   * @dev Initializes an upgradeable proxy backed by the implementation at `_logic`.
   */
  constructor(
    address _logic,
    address _admin,
    bytes memory _data,
    address _ambBridge,
    uint256 _adminChainId
  ) TransparentUpgradeableProxy(_logic, _admin, _data) CrossChainGuard(_ambBridge, _adminChainId, _admin) {}

  /**
   * @dev Modifier used internally that will delegate the call to the implementation unless the sender is the cross chain admin.
   */
  modifier ifAdmin() override {
    if (isCalledByOwner()) {
      _;
    } else {
      _fallback();
    }
  }

  /**
   * @dev Override to allow admin access the fallback function.
   */
  function _beforeFallback() internal override {}
}
