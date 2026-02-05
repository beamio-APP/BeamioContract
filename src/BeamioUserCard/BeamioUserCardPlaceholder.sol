// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BeamioUserCardPlaceholder
 * @notice 临时占位符合约，用于解决 Factory 和 UserCard 的循环依赖问题
 * @dev 这个合约仅用于满足 Factory 构造函数的要求，稍后会被真正的 UserCard 替换
 */
contract BeamioUserCardPlaceholder {
    address public owner;
    
    constructor() {
        owner = msg.sender;
    }
    
    // 提供一个简单的函数以确保合约有代码
    function placeholder() external pure returns (string memory) {
        return "This is a placeholder contract";
    }
}
