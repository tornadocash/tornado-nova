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

import "@openzeppelin/contracts/contracts/token/ERC20/IERC20.sol";
import "./MerkleTreeWithHistory.sol";

interface IERC6777 is IERC20 {
  function transferAndCall(
    address,
    uint256,
    bytes calldata
  ) external returns (bool);
}

interface IVerifier {
  function verifyProof(bytes memory _proof, uint256[7] memory _input) external view returns (bool);

  function verifyProof(bytes memory _proof, uint256[21] memory _input) external view returns (bool);
}

interface IERC20Receiver {
  function onTokenBridged(
    IERC6777 token,
    uint256 value,
    bytes calldata data
  ) external;
}

contract TornadoPool is MerkleTreeWithHistory, IERC20Receiver {
  int256 public constant MAX_EXT_AMOUNT = 2**248;
  uint256 public constant MAX_FEE = 2**248;

  IVerifier public immutable verifier2;
  IVerifier public immutable verifier16;
  IERC6777 public immutable token;
  address public immutable omniBridge;
  address public immutable l1Unwrapper;

  uint256 public totalDeposited;
  mapping(bytes32 => bool) public nullifierHashes;

  struct ExtData {
    address recipient;
    int256 extAmount;
    address relayer;
    uint256 fee;
    bytes encryptedOutput1;
    bytes encryptedOutput2;
    bool isL1Withdrawal;
  }

  struct Proof {
    bytes proof;
    bytes32 root;
    bytes32[] inputNullifiers;
    bytes32[2] outputCommitments;
    uint256 publicAmount;
    bytes32 extDataHash;
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
    uint32 _levels,
    address _hasher,
    IERC6777 _token,
    address _omniBridge,
    address _l1Unwrapper
  ) MerkleTreeWithHistory(_levels, _hasher) {
    verifier2 = _verifier2;
    verifier16 = _verifier16;
    token = _token;
    omniBridge = _omniBridge;
    l1Unwrapper = _l1Unwrapper;
  }

  function transact(Proof memory _args, ExtData memory _extData) public {
    if (_extData.extAmount > 0) {
      // for deposits from L2
      token.transferFrom(msg.sender, address(this), uint256(_extData.extAmount));
      totalDeposited += uint256(_extData.extAmount);
    }

    _transact(_args, _extData);
  }

  function _transact(Proof memory _args, ExtData memory _extData) internal {
    require(isKnownRoot(_args.root), "Invalid merkle root");
    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      require(!isSpent(_args.inputNullifiers[i]), "Input is already spent");
    }
    require(uint256(_args.extDataHash) == uint256(keccak256(abi.encode(_extData))) % FIELD_SIZE, "Incorrect external data hash");
    require(_args.publicAmount == calculatePublicAmount(_extData.extAmount, _extData.fee), "Invalid public amount");
    require(verifyProof(_args), "Invalid transaction proof");

    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      nullifierHashes[_args.inputNullifiers[i]] = true;
    }

    if (_extData.extAmount < 0) {
      require(_extData.recipient != address(0), "Can't withdraw to zero address");
      if (_extData.isL1Withdrawal) {
        token.transferAndCall(omniBridge, uint256(-_extData.extAmount), abi.encodePacked(l1Unwrapper, _extData.recipient));
      } else {
        token.transfer(_extData.recipient, uint256(-_extData.extAmount));
      }
      totalDeposited -= uint256(-_extData.extAmount);
    }
    if (_extData.fee > 0) {
      token.transfer(_extData.relayer, _extData.fee);
    }

    _insert(_args.outputCommitments[0], _args.outputCommitments[1]);
    emit NewCommitment(_args.outputCommitments[0], nextIndex - 2, _extData.encryptedOutput1);
    emit NewCommitment(_args.outputCommitments[1], nextIndex - 1, _extData.encryptedOutput2);
    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      emit NewNullifier(_args.inputNullifiers[i]);
    }
  }

  function calculatePublicAmount(int256 _extAmount, uint256 _fee) public pure returns (uint256) {
    require(_fee < MAX_FEE, "Invalid fee");
    require(_extAmount > -MAX_EXT_AMOUNT && _extAmount < MAX_EXT_AMOUNT, "Invalid ext amount");
    int256 publicAmount = _extAmount - int256(_fee);
    return (publicAmount >= 0) ? uint256(publicAmount) : FIELD_SIZE - uint256(-publicAmount);
  }

  /** @dev whether a note is already spent */
  function isSpent(bytes32 _nullifierHash) public view returns (bool) {
    return nullifierHashes[_nullifierHash];
  }

  function verifyProof(Proof memory _args) public view returns (bool) {
    if (_args.inputNullifiers.length == 2) {
      return
        verifier2.verifyProof(
          _args.proof,
          [
            uint256(_args.root),
            _args.publicAmount,
            uint256(_args.extDataHash),
            uint256(_args.inputNullifiers[0]),
            uint256(_args.inputNullifiers[1]),
            uint256(_args.outputCommitments[0]),
            uint256(_args.outputCommitments[1])
          ]
        );
    } else if (_args.inputNullifiers.length == 16) {
      return
        verifier16.verifyProof(
          _args.proof,
          [
            uint256(_args.root),
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
            uint256(_args.outputCommitments[1])
          ]
        );
    } else {
      revert("unsupported input count");
    }
  }

  function register(bytes memory _publicKey) public {
    emit PublicKey(msg.sender, _publicKey);
  }

  function registerAndTransact(
    bytes memory _publicKey,
    Proof memory _proofArgs,
    ExtData memory _extData
  ) public {
    register(_publicKey);
    transact(_proofArgs, _extData);
  }

  function onTokenBridged(
    IERC6777 _token,
    uint256 _amount,
    bytes calldata _data
  ) external override {
    (bytes memory _publicKey, Proof memory _args, ExtData memory _extData) = abi.decode(_data, (bytes, Proof, ExtData));
    require(_token == token, "provided token is not supported");
    require(msg.sender == omniBridge, "only omni bridge");
    require(_amount == uint256(_extData.extAmount), "amount from bridge is incorrect");
    require(uint256(_extData.extAmount) + totalDeposited >= token.balanceOf(address(this)), "bridge did not send enough tokens");

    totalDeposited += uint256(_extData.extAmount);

    if (_publicKey.length != 0) {
      register(_publicKey);
    }
    _transact(_args, _extData);
  }
}
