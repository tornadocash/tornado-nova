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
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

interface IVerifier {
  function verifyProof(bytes memory _proof, uint256[9] memory _input) external view returns (bool);

  function verifyProof(bytes memory _proof, uint256[23] memory _input) external view returns (bool);
}

interface ERC20 {
  function transfer(address to, uint256 value) external returns (bool);
}

contract TornadoPool is Initializable {
  uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
  int256 public constant MAX_EXT_AMOUNT = 2**248;
  uint256 public constant MAX_FEE = 2**248;

  mapping(bytes32 => bool) public nullifierHashes;
  bytes32 public currentRoot;
  uint256 public currentCommitmentIndex;
  IVerifier public immutable verifier2;
  IVerifier public immutable verifier16;

  struct ExtData {
    address payable recipient;
    int256 extAmount;
    address payable relayer;
    uint256 fee;
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
    uint256 publicAmount;
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
  constructor(IVerifier _verifier2, IVerifier _verifier16) {
    verifier2 = _verifier2;
    verifier16 = _verifier16;
  }

  function initialize(bytes32 _currentRoot) external initializer {
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
    require(_args.publicAmount == calculatePublicAmount(_extData.extAmount, _extData.fee), "Invalid public amount");
    require(verifyProof(_args), "Invalid transaction proof");

    currentRoot = _args.newRoot;
    currentCommitmentIndex = cachedCommitmentIndex + 2;
    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      nullifierHashes[_args.inputNullifiers[i]] = true;
    }

    if (_extData.extAmount > 0) {
      require(msg.value == uint256(_extData.extAmount), "Incorrect amount of ETH sent on deposit");
    } else if (_extData.extAmount < 0) {
      require(msg.value == 0, "Sent ETH amount should be 0 for withdrawal");
      require(_extData.recipient != address(0), "Can't withdraw to zero address");
      _transfer(_extData.recipient, uint256(-_extData.extAmount));
    } else {
      require(msg.value == 0, "Sent ETH amount should be 0 for transaction");
    }

    if (_extData.fee > 0) {
      _transfer(_extData.relayer, _extData.fee);
    }

    emit NewCommitment(_args.outputCommitments[0], cachedCommitmentIndex, _extData.encryptedOutput1);
    emit NewCommitment(_args.outputCommitments[1], cachedCommitmentIndex + 1, _extData.encryptedOutput2);
    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      emit NewNullifier(_args.inputNullifiers[i]);
    }
  }

  function _transfer(address payable _to, uint256 _amount) internal {
    uint256 id;
    assembly {
      id := chainid()
    }
    if (id == 10) {
      ERC20(0x4200000000000000000000000000000000000006).transfer(_to, _amount);
    } else {
      _to.transfer(_amount);
    }
  }

  function calculatePublicAmount(int256 _extAmount, uint256 _fee) public pure returns(uint256) {
    require(_fee < MAX_FEE, "Invalid fee");
    require(_extAmount > -MAX_EXT_AMOUNT && _extAmount < MAX_EXT_AMOUNT, "Invalid ext amount");
    int256 publicAmount = _extAmount - int256(_fee);
    return (publicAmount >= 0) ? uint256(publicAmount) : FIELD_SIZE - uint256(-publicAmount);
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
            _args.publicAmount,
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
            _args.publicAmount,
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
