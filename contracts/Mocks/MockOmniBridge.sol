// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;
pragma abicoder v2;

import { IAMB, IOmniBridge } from "../interfaces/IBridge.sol";

contract MockOmniBridge is IOmniBridge {
  IAMB public AMB;

  struct Call {
    address who;
    bytes callData;
  }

  constructor(IAMB _AMB) {
    AMB = _AMB;
  }

  function bridgeContract() external view override returns (IAMB) {
    return AMB;
  }

  function execute(Call[] calldata _calls) external returns (bool success, bytes memory result) {
    for (uint256 i = 0; i < _calls.length; i++) {
      (success, result) = _calls[i].who.call(_calls[i].callData);
    }
  }

  event OnTokenTransfer(address contr, address from, address receiver, uint256 value, bytes data);

  function onTokenTransfer(
    address _from,
    uint256 _value,
    bytes memory _data
  ) external returns (bool) {
    bytes memory data = new bytes(0);
    address receiver = _from;
    if (_data.length >= 20) {
      receiver = bytesToAddress(_data);
      if (_data.length > 20) {
        assembly {
          let size := sub(mload(_data), 20)
          data := add(_data, 20)
          mstore(data, size)
        }
      }
    }
    emit OnTokenTransfer(msg.sender, _from, receiver, _value, data);
    //bridgeSpecificActionsOnTokenTransfer(msg.sender, _from, receiver, _value, data);
    return true;
  }

  function bytesToAddress(bytes memory _bytes) internal pure returns (address addr) {
    assembly {
      addr := mload(add(_bytes, 20))
    }
  }
}
