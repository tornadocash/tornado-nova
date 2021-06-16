// SPDX-License-Identifier: MIT
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

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; // todo: maybe remove?

interface IVerifier {
  function verifyProof(bytes memory _proof, uint256[9] memory _input) external returns (bool);

  function verifyProof(bytes memory _proof, uint256[23] memory _input) external returns (bool);
}

contract TornadoPool is ReentrancyGuard {
  uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
  uint256 public constant MAX_EXT_AMOUNT = 2**248 - 1;

  mapping(bytes32 => bool) public nullifierHashes;
  bytes32 public currentRoot;
  uint256 public currentCommitmentIndex;
  IVerifier public verifier2;
  IVerifier public verifier16;

  struct ExtData {
    address payable recipient;
    address payable relayer;
    bytes encryptedOutput1;
    bytes encryptedOutput2;
  }

  // todo: event Transaction();
  event NewCommitment(bytes32 commitment, uint256 index, bytes encryptedOutput);
  event NewNullifier(bytes32 nullifier);
  event Withdraw(bytes32 indexed nullifier); // todo emit it on withdraw so we can easily find the withdraw tx for user on UI

  /**
    @dev The constructor
    @param _verifier2 the address of SNARK verifier for this contract
    @param _verifier16 the address of SNARK verifier for this contract
  */
  constructor(
    IVerifier _verifier2,
    IVerifier _verifier16,
    bytes32 _currentRoot
  ) public {
    verifier2 = _verifier2;
    verifier16 = _verifier16;
    currentRoot = _currentRoot;
  }

  function transaction(
    bytes calldata _proof,
    bytes32 _root,
    bytes32 _newRoot,
    bytes32[] calldata _inputNullifiers,
    bytes32[2] calldata _outputCommitments,
    uint256 _extAmount,
    uint256 _fee,
    ExtData calldata _extData,
    bytes32 _extDataHash
  ) external payable nonReentrant {
    require(currentRoot == _root, "Invalid merkle root");
    for (uint256 i = 0; i < _inputNullifiers.length; i++) {
      require(!isSpent(_inputNullifiers[i]), "Input is already spent");
    }
    require(uint256(_extDataHash) == uint256(keccak256(abi.encode(_extData))) % FIELD_SIZE, "Incorrect external data hash");
    if (_inputNullifiers.length == 2) {
      require(
        verifier2.verifyProof(
          _proof,
          [
            uint256(_root),
            uint256(_newRoot),
            uint256(_inputNullifiers[0]),
            uint256(_inputNullifiers[1]),
            uint256(_outputCommitments[0]),
            uint256(_outputCommitments[1]),
            _extAmount,
            _fee,
            uint256(_extDataHash)
          ]
        ),
        "Invalid transaction proof"
      );
    } else if (_inputNullifiers.length == 16) {
      require(
        verifier16.verifyProof(
          _proof,
          [
            uint256(_root),
            uint256(_newRoot),
            uint256(_inputNullifiers[0]),
            uint256(_inputNullifiers[1]),
            uint256(_inputNullifiers[2]),
            uint256(_inputNullifiers[3]),
            uint256(_inputNullifiers[4]),
            uint256(_inputNullifiers[5]),
            uint256(_inputNullifiers[6]),
            uint256(_inputNullifiers[7]),
            uint256(_inputNullifiers[8]),
            uint256(_inputNullifiers[9]),
            uint256(_inputNullifiers[10]),
            uint256(_inputNullifiers[11]),
            uint256(_inputNullifiers[12]),
            uint256(_inputNullifiers[13]),
            uint256(_inputNullifiers[14]),
            uint256(_inputNullifiers[15]),
            uint256(_outputCommitments[0]),
            uint256(_outputCommitments[1]),
            _extAmount,
            _fee,
            uint256(_extDataHash)
          ]
        ),
        "Invalid transaction proof"
      );
    } else {
      revert("unsupported input count");
    }

    currentRoot = _newRoot;
    for (uint256 i = 0; i < _inputNullifiers.length; i++) {
      nullifierHashes[_inputNullifiers[i]] = true;
    }

    int256 extAmount = calculateExternalAmount(_extAmount);
    if (extAmount > 0) {
      require(msg.value == uint256(extAmount), "Incorrect amount of ETH sent on deposit");
    } else if (extAmount < 0) {
      require(msg.value == 0, "Sent ETH amount should be 0 for withdrawal");
      require(_extData.recipient != address(0), "Can't withdraw to zero address");
      _extData.recipient.transfer(uint256(-extAmount));
    } else {
      require(msg.value == 0, "Sent ETH amount should be 0 for transaction");
    }

    if (_fee > 0) {
      _extData.relayer.transfer(_fee);
    }

    // todo enforce currentCommitmentIndex value in snark
    emit NewCommitment(_outputCommitments[0], currentCommitmentIndex++, _extData.encryptedOutput1);
    emit NewCommitment(_outputCommitments[1], currentCommitmentIndex++, _extData.encryptedOutput2);
    for (uint256 i = 0; i < _inputNullifiers.length; i++) {
      emit NewNullifier(_inputNullifiers[i]);
    }
  }

  function calculateExternalAmount(uint256 _extAmount) public pure returns (int256) {
    // -MAX_EXT_AMOUNT < extAmount < MAX_EXT_AMOUNT
    if (_extAmount < MAX_EXT_AMOUNT) {
      return int256(_extAmount);
    } else if (_extAmount > FIELD_SIZE - MAX_EXT_AMOUNT) {
      // FIELD_SIZE - MAX_EXT_AMOUNT < _extAmount < FIELD_SIZE
      return -(int256(FIELD_SIZE) - int256(_extAmount));
    } else {
      revert("Invalid extAmount value");
    }
  }

  /** @dev whether a note is already spent */
  function isSpent(bytes32 _nullifierHash) public view returns (bool) {
    return nullifierHashes[_nullifierHash];
  }
}
