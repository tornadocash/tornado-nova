// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import { IAMB } from "./interfaces/IBridge.sol";
import "@openzeppelin/contracts/proxy/TransparentUpgradeableProxy.sol";

/**
 * @dev TransparentUpgradeableProxy where admin acts from a different chain.
 */
contract CrossChainUpgradeableProxy is TransparentUpgradeableProxy {
  IAMB public immutable ambBridge;
  bytes32 public immutable adminChainId;

  /**
   * @dev Initializes an upgradeable proxy backed by the implementation at `_logic`.
   */
  constructor(
    address _logic,
    address _admin,
    bytes memory _data,
    IAMB _ambBridge,
    uint256 _adminChainId
  ) TransparentUpgradeableProxy(_logic, _admin, _data) {
    ambBridge = _ambBridge;
    adminChainId = bytes32(uint256(_adminChainId));
  }

  /**
   * @dev Modifier used internally that will delegate the call to the implementation unless the sender is the cross chain admin.
   */
  modifier ifAdmin() override {
    if (
      msg.sender == address(ambBridge) &&
      ambBridge.messageSourceChainId() == adminChainId &&
      ambBridge.messageSender() == _admin()
    ) {
      _;
    } else {
      _fallback();
    }
  }
}
