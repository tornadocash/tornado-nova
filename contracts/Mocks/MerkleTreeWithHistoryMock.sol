// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import "../MerkleTreeWithHistory.sol";

contract MerkleTreeWithHistoryMock is MerkleTreeWithHistory {
  constructor(uint32 _levels, address _hasher) MerkleTreeWithHistory(_levels, _hasher) {}

  function insert(bytes32 _leaf1, bytes32 _leaf2) public returns (uint32 index) {
    return _insert(_leaf1, _leaf2);
  }

  function initialize() external {
    super._initialize();
  }
}
