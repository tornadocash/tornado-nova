// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract WETH is ERC20 {
  
  constructor(
    string memory name,
    string memory ticker
  ) ERC20(name, ticker) {}

  function deposit() external payable {
    _mint(msg.sender, msg.value);
  }

  function withdraw(uint256 value) external {
    _burn(msg.sender, value);     
    (bool success, ) = msg.sender.call{value: value}("");
    require(success, "WETH: ETH transfer failed");
  }
}
