// https://tornado.cash
/*
 * d888888P                                           dP              a88888b.                   dP
 *    88                                              88             d8'   `88                   88
 *    88    .d8888b. 88d888b. 88d888b. .d8888b. .d888b88 .d8888b.    88        .d8888b. .d8888b. 88d888b.
 *    88    88'  `88 88'  `88 88'  `88 88'  `88 88'  `88 88'  `88    88        88'  `88 Y8ooooo. 88'  `88
 *    88    88.  .88 88       88    88 88.  .88 88.  .88 88.  .88 dP Y8.   .88 88.  .88       88 88    88
 *    dP    `88888P' dP       dP    dP `88888P8 `88888P8 `88888P' 88  Y88888P' `88888P8 `88888P' dP    dP
 * ooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo
 */

// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

interface IHasher {
  function poseidon(bytes32[2] calldata inputs) external pure returns (bytes32);
}

contract MerkleTreeWithHistory is Initializable {
  uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
  uint256 public constant ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292; // = keccak256("tornado") % FIELD_SIZE

  IHasher public immutable hasher;
  uint32 public immutable levels;

  // the following variables are made public for easier testing and debugging and
  // are not supposed to be accessed in regular code

  // filledSubtrees and roots could be bytes32[size], but using mappings makes it cheaper because
  // it removes index range check on every interaction
  mapping(uint256 => bytes32) public filledSubtrees;
  mapping(uint256 => bytes32) public roots;
  uint32 public constant ROOT_HISTORY_SIZE = 100;
  uint32 public currentRootIndex = 0; // todo remove
  uint32 public nextIndex = 0;

  constructor(uint32 _levels, address _hasher) {
    require(_levels > 0, "_levels should be greater than zero");
    require(_levels < 32, "_levels should be less than 32");
    levels = _levels;
    hasher = IHasher(_hasher);
  }

  function _initialize() internal {
    for (uint32 i = 0; i < levels; i++) {
      filledSubtrees[i] = zeros(i);
    }

    roots[0] = zeros(levels);
  }

  /**
    @dev Hash 2 tree leaves, returns Poseidon(_left, _right)
  */
  function hashLeftRight(bytes32 _left, bytes32 _right) public view returns (bytes32) {
    require(uint256(_left) < FIELD_SIZE, "_left should be inside the field");
    require(uint256(_right) < FIELD_SIZE, "_right should be inside the field");
    bytes32[2] memory input;
    input[0] = _left;
    input[1] = _right;
    return hasher.poseidon(input);
  }

  // Modified to insert pairs of leaves for better efficiency
  function _insert(bytes32 _leaf1, bytes32 _leaf2) internal returns (uint32 index) {
    uint32 _nextIndex = nextIndex;
    require(_nextIndex != uint32(2)**levels, "Merkle tree is full. No more leaves can be added");
    uint32 currentIndex = _nextIndex / 2;
    bytes32 currentLevelHash = hashLeftRight(_leaf1, _leaf2);
    bytes32 left;
    bytes32 right;

    for (uint32 i = 1; i < levels; i++) {
      if (currentIndex % 2 == 0) {
        left = currentLevelHash;
        right = zeros(i);
        filledSubtrees[i] = currentLevelHash;
      } else {
        left = filledSubtrees[i];
        right = currentLevelHash;
      }
      currentLevelHash = hashLeftRight(left, right);
      currentIndex /= 2;
    }

    uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
    currentRootIndex = newRootIndex;
    roots[newRootIndex] = currentLevelHash;
    nextIndex = _nextIndex + 2;
    return _nextIndex;
  }

  /**
    @dev Whether the root is present in the root history
  */
  function isKnownRoot(bytes32 _root) public view returns (bool) {
    if (_root == 0) {
      return false;
    }
    uint32 _currentRootIndex = currentRootIndex;
    uint32 i = _currentRootIndex;
    do {
      if (_root == roots[i]) {
        return true;
      }
      if (i == 0) {
        i = ROOT_HISTORY_SIZE;
      }
      i--;
    } while (i != _currentRootIndex);
    return false;
  }

  /**
    @dev Returns the last root
  */
  function getLastRoot() public view returns (bytes32) {
    return roots[currentRootIndex];
  }

  /// @dev provides Zero (Empty) elements for a MiMC MerkleTree. Up to 32 levels
  function zeros(uint256 i) public pure returns (bytes32) {
    if (i == 0) return bytes32(0x2fe54c60d3acabf3343a35b6eba15db4821b340f76e741e2249685ed4899af6c);
    else if (i == 1) return bytes32(0x1a332ca2cd2436bdc6796e6e4244ebf6f7e359868b7252e55342f766e4088082);
    else if (i == 2) return bytes32(0x2fb19ac27499bdf9d7d3b387eff42b6d12bffbc6206e81d0ef0b0d6b24520ebd);
    else if (i == 3) return bytes32(0x18d0d6e282d4eacbf18efc619a986db763b75095ed122fac7d4a49418daa42e1);
    else if (i == 4) return bytes32(0x054dec40f76a0f5aaeff1a85a4a3721b92b4ad244362d30b0ef8ed7033de11d3);
    else if (i == 5) return bytes32(0x1d24c91f8d40f1c2591edec19d392905cf5eb01eada48d71836177ef11aea5b2);
    else if (i == 6) return bytes32(0x0fb63621cfc047eba2159faecfa55b120d7c81c0722633ef94e20e27675e378f);
    else if (i == 7) return bytes32(0x277b08f214fe8c5504a79614cdec5abd7b6adc9133fe926398684c82fd798b44);
    else if (i == 8) return bytes32(0x2633613437c1fd97f7c798e2ea30d52cfddee56d74f856a541320ae86ddaf2de);
    else if (i == 9) return bytes32(0x00768963fa4b993fbfece3619bfaa3ca4afd7e3864f11b09a0849dbf4ad25807);
    else if (i == 10) return bytes32(0x0e63ff9df484c1a21478bd27111763ef203177ec0a7ef3a3cd43ec909f587bb0);
    else if (i == 11) return bytes32(0x0e6a4bfb0dd0ac8bf5517eaac48a95ba783dabe9f64494f9c892d3e8431eaab3);
    else if (i == 12) return bytes32(0x0164a46b3ffff8baca00de7a130a63d105f1578076838502b99488505d5b3d35);
    else if (i == 13) return bytes32(0x145a6f1521c02b250cc76eb35cd67c9b0b22473577de3778e4c51903836c8957);
    else if (i == 14) return bytes32(0x29849fc5b55303a660bad33d986fd156d48516ec58a0f0a561a03b704a802254);
    else if (i == 15) return bytes32(0x26639dd486b374e98ac6da34e8651b3fca58c51f1c2f857dd82045f27fc8dbe6);
    else if (i == 16) return bytes32(0x2aa39214b887ee877e60afdb191390344c68177c30a0b8646649774174de5e33);
    else if (i == 17) return bytes32(0x09b397d253e41a521d042ffe01f8c33ae37d4c7da21af68693aafb63d599d708);
    else if (i == 18) return bytes32(0x02fbfd397ad901cea38553239aefec016fcb6a19899038503f04814cbb79a511);
    else if (i == 19) return bytes32(0x266640a877ec97a91f6c95637f843eeac8718f53f311bac9cba7d958df646f9d);
    else if (i == 20) return bytes32(0x29f9a0a07a22ab214d00aaa0190f54509e853f3119009baecb0035347606b0a9);
    else if (i == 21) return bytes32(0x0a1fda67bffa0ab3a755f23fdcf922720820b6a96616a5ca34643cd0b935e3d6);
    else if (i == 22) return bytes32(0x19507199eb76b5ec5abe538a01471d03efb6c6984739c77ec61ada2ba2afb389);
    else if (i == 23) return bytes32(0x26bd93d26b751484942282e27acfb6d193537327a831df6927e19cdfc73c3e64);
    else if (i == 24) return bytes32(0x2eb88a9c6b00a4bc6ea253268090fe1d255f6fe02d2eb745517723aae44d7386);
    else if (i == 25) return bytes32(0x13e50d0bda78be97792df40273cbb16f0dc65c0697d81a82d07d0f6eee80a164);
    else if (i == 26) return bytes32(0x2ea95776929000133246ff8d9fdcba179d0b262b9e910558309bac1c1ec03d7a);
    else if (i == 27) return bytes32(0x1a640d6ef66e356c795396c0957b06a99891afe0c493f4d0bdfc0450764bae60);
    else if (i == 28) return bytes32(0x2b17979f2c2048dd9e4ee5f482cced21435ea8cc54c32f80562e39a5016b0496);
    else if (i == 29) return bytes32(0x29ba6a30de50542e261abfc7ee0c68911002d3acd4dd4c02ad59aa96805b20bb);
    else if (i == 30) return bytes32(0x103fcf1c8a98ebe50285f6e669077a579308311fd44bb6895d5da7ba7fd3564e);
    else if (i == 31) return bytes32(0x166bdd01780976e655f5278260c638dcf10fe7c136f37c9152cbcaabef901f4d);
    else if (i == 32) return bytes32(0x2712c601a9b8b2abd396a619327095d3f1ea86a6c07d6df416a3973a1a4b3ce5);
    else revert("Index out of bounds");
  }
}
