// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/contracts/proxy/TransparentUpgradeableProxy.sol";

// https://github.com/ethereum-optimism/optimism/blob/c7bc85deee999b8edfbe187b302d0ea262638ca9/packages/contracts/contracts/optimistic-ethereum/iOVM/bridge/messaging/iOVM_CrossDomainMessenger.sol
interface iOVM_CrossDomainMessenger {
  function xDomainMessageSender() external view returns (address);
}

/**
 * @dev TransparentUpgradeableProxy where admin acts from a different chain.
 */
contract CrossChainUpgradeableProxy is TransparentUpgradeableProxy {
  // https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts/deployments/README.md
  iOVM_CrossDomainMessenger public constant messenger = iOVM_CrossDomainMessenger(0x4200000000000000000000000000000000000007);

  /**
   * @dev Initializes an upgradeable proxy backed by the implementation at `_logic`.
   */
  constructor(
    address _logic,
    address _admin,
    bytes memory _data
  ) TransparentUpgradeableProxy(_logic, _admin, _data) {}

  /**
   * @dev Modifier used internally that will delegate the call to the implementation unless the sender is the cross chain admin.
   */
  modifier ifAdmin() override {
    if (msg.sender == address(messenger) && messenger.xDomainMessageSender() == _admin()) {
      _;
    } else {
      _fallback();
    }
  }
}
