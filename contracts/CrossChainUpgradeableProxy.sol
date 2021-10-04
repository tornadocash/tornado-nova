// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/contracts/proxy/TransparentUpgradeableProxy.sol";

// https://docs.tokenbridge.net/amb-bridge/development-of-a-cross-chain-application/how-to-develop-xchain-apps-by-amb#call-a-method-in-another-chain-using-the-amb-bridge

interface IAMB {
  function messageSender() external view returns (address);

  function messageSourceChainId() external view returns (bytes32);
}

interface IOmniBridge {
  function bridgeContract() external view returns (IAMB);
}

/**
 * @dev TransparentUpgradeableProxy where admin acts from a different chain.
 */
contract CrossChainUpgradeableProxy is TransparentUpgradeableProxy {
  IOmniBridge public immutable omniBridge;
  bytes32 public immutable adminChainId;

  /**
   * @dev Initializes an upgradeable proxy backed by the implementation at `_logic`.
   */
  constructor(
    address _logic,
    address _admin,
    bytes memory _data,
    IOmniBridge _omniBridge,
    uint256 _adminChainId
  ) TransparentUpgradeableProxy(_logic, _admin, _data) {
    omniBridge = _omniBridge;
    adminChainId = bytes32(uint256(_adminChainId));
  }

  /**
   * @dev Modifier used internally that will delegate the call to the implementation unless the sender is the cross chain admin.
   */
  modifier ifAdmin() override {
    if (
      msg.sender == address(omniBridge) &&
      omniBridge.bridgeContract().messageSourceChainId() == adminChainId &&
      omniBridge.bridgeContract().messageSender() == _admin()
    ) {
      _;
    } else {
      _fallback();
    }
  }
}
