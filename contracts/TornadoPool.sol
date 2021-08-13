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

  struct Proof {
    bytes proof;
    bytes32 root;
    bytes32 newRoot;
    bytes32[] inputNullifiers;
    bytes32[2] outputCommitments;
    uint256 outPathIndices;
    uint256 extAmount;
    uint256 fee;
    bytes32 extDataHash;
  }

  struct Register {
    bytes pubKey;
    bytes account;
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

  function transaction(Proof calldata _args, ExtData calldata _extData) public payable {
    require(currentRoot == _args.root, "Invalid merkle root");
    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      require(!isSpent(_args.inputNullifiers[i]), "Input is already spent");
    }
    require(uint256(_args.extDataHash) == uint256(keccak256(abi.encode(_extData))) % FIELD_SIZE, "Incorrect external data hash");
    uint256 cachedCommitmentIndex = currentCommitmentIndex;
    require(_args.outPathIndices == cachedCommitmentIndex >> 1, "Invalid merkle tree insert position");
    require(verifyProof(_args), "Invalid transaction proof");

    currentRoot = _args.newRoot;
    currentCommitmentIndex = cachedCommitmentIndex + 2;
    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      nullifierHashes[_args.inputNullifiers[i]] = true;
    }

    int256 extAmount = calculateExternalAmount(_args.extAmount);
    if (extAmount > 0) {
      require(msg.value == uint256(_args.extAmount), "Incorrect amount of ETH sent on deposit");
    } else if (extAmount < 0) {
      require(msg.value == 0, "Sent ETH amount should be 0 for withdrawal");
      require(_extData.recipient != address(0), "Can't withdraw to zero address");
      _extData.recipient.transfer(uint256(-extAmount));
    } else {
      require(msg.value == 0, "Sent ETH amount should be 0 for transaction");
    }

    if (_args.fee > 0) {
      _extData.relayer.transfer(_args.fee);
    }

    emit NewCommitment(_args.outputCommitments[0], cachedCommitmentIndex, _extData.encryptedOutput1);
    emit NewCommitment(_args.outputCommitments[1], cachedCommitmentIndex + 1, _extData.encryptedOutput2);
    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      emit NewNullifier(_args.inputNullifiers[i]);
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

  function verifyProof(Proof calldata _args) public view returns (bool) {
    if (_args.inputNullifiers.length == 2) {
      return
        verifier2.verifyProof(
          _args.proof,
          [
            uint256(_args.root),
            uint256(_args.newRoot),
            _args.extAmount,
            _args.fee,
            uint256(_args.extDataHash),
            uint256(_args.inputNullifiers[0]),
            uint256(_args.inputNullifiers[1]),
            uint256(_args.outputCommitments[0]),
            uint256(_args.outputCommitments[1]),
            _args.outPathIndices
          ]
        );
    } else if (_args.inputNullifiers.length == 16) {
      return
        verifier16.verifyProof(
          _args.proof,
          [
            uint256(_args.root),
            uint256(_args.newRoot),
            _args.extAmount,
            _args.fee,
            uint256(_args.extDataHash),
            uint256(_args.inputNullifiers[0]),
            uint256(_args.inputNullifiers[1]),
            uint256(_args.inputNullifiers[2]),
            uint256(_args.inputNullifiers[3]),
            uint256(_args.inputNullifiers[4]),
            uint256(_args.inputNullifiers[5]),
            uint256(_args.inputNullifiers[6]),
            uint256(_args.inputNullifiers[7]),
            uint256(_args.inputNullifiers[8]),
            uint256(_args.inputNullifiers[9]),
            uint256(_args.inputNullifiers[10]),
            uint256(_args.inputNullifiers[11]),
            uint256(_args.inputNullifiers[12]),
            uint256(_args.inputNullifiers[13]),
            uint256(_args.inputNullifiers[14]),
            uint256(_args.inputNullifiers[15]),
            uint256(_args.outputCommitments[0]),
            uint256(_args.outputCommitments[1]),
            _args.outPathIndices
          ]
        );
    } else {
      revert("unsupported input count");
    }
  }

  function register(Register calldata args) public {
    emit PublicKey(msg.sender, args.pubKey);
    emit EncryptedAccount(msg.sender, args.account);
  }

  function registerAndTransact(
    Register calldata _registerArgs,
    Proof calldata _proofArgs,
    ExtData calldata _extData
  ) external payable {
    register(_registerArgs);
    transaction(_proofArgs, _extData);
  }
}
