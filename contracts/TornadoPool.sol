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

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

interface IVerifier {
  function verifyProof(bytes memory _proof, uint256[10] memory _input) external view returns (bool);

  function verifyProof(bytes memory _proof, uint256[24] memory _input) external view returns (bool);
}

contract TornadoPool {
  uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
  uint256 public constant MAX_EXT_AMOUNT = 2**248 - 1;

  mapping(bytes32 => bool) public nullifierHashes;
  bytes32 public currentRoot;
  uint256 public currentCommitmentIndex;
  IVerifier public immutable verifier2;
  IVerifier public immutable verifier16;

  struct ExtData {
    address payable recipient;
    address payable relayer;
    bytes encryptedOutput1;
    bytes encryptedOutput2;
  }

  event NewCommitment(bytes32 commitment, uint256 index, bytes encryptedOutput);
  event NewNullifier(bytes32 nullifier);
  event PublicKey(address indexed owner, bytes key);
  event EncryptedAccount(address indexed owner, bytes account);

  /**
    @dev The constructor
    @param _verifier2 the address of SNARK verifier for 2 inputs
    @param _verifier16 the address of SNARK verifier for 16 inputs
  */
  constructor(
    IVerifier _verifier2,
    IVerifier _verifier16,
    bytes32 _currentRoot
  ) {
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
    uint256 _outPathIndices,
    uint256 _extAmount,
    uint256 _fee,
    ExtData calldata _extData,
    bytes32 _extDataHash
  ) external payable {
    require(currentRoot == _root, "Invalid merkle root");
    for (uint256 i = 0; i < _inputNullifiers.length; i++) {
      require(!isSpent(_inputNullifiers[i]), "Input is already spent");
    }
    require(uint256(_extDataHash) == uint256(keccak256(abi.encode(_extData))) % FIELD_SIZE, "Incorrect external data hash");
    require(_outPathIndices == currentCommitmentIndex >> 1, "Invalid merkle tree insert position");
    require(
      verifyProof(_proof, _root, _newRoot, _inputNullifiers, _outputCommitments, _outPathIndices, _extAmount, _fee, _extDataHash),
      "Invalid transaction proof"
    );

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

  function verifyProof(
    bytes memory _proof,
    bytes32 _root,
    bytes32 _newRoot,
    bytes32[] memory _inputNullifiers,
    bytes32[2] memory _outputCommitments,
    uint256 _outPathIndices,
    uint256 _extAmount,
    uint256 _fee,
    bytes32 _extDataHash
  ) public view returns (bool) {
    if (_inputNullifiers.length == 2) {
      return
        verifier2.verifyProof(
          _proof,
          [
            uint256(_root),
            uint256(_newRoot),
            _extAmount,
            _fee,
            uint256(_extDataHash),
            uint256(_inputNullifiers[0]),
            uint256(_inputNullifiers[1]),
            uint256(_outputCommitments[0]),
            uint256(_outputCommitments[1]),
            _outPathIndices
          ]
        );
    } else if (_inputNullifiers.length == 16) {
      return
        verifier16.verifyProof(
          _proof,
          [
            uint256(_root),
            uint256(_newRoot),
            _extAmount,
            _fee,
            uint256(_extDataHash),
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
            _outPathIndices
          ]
        );
    } else {
      revert("unsupported input count");
    }
  }

  function register(bytes calldata _pubKey, bytes calldata _account) external {
    emit PublicKey(msg.sender, _pubKey);
    emit EncryptedAccount(msg.sender, _account);
  }
}
