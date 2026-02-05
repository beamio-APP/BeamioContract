// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Errors.sol";

contract BeamioUserCardDeployerV07 {
    address public owner;
    address public factory;

    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event FactoryChanged(address indexed oldFactory, address indexed newFactory);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert DEP_NotOwner();
        _;
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert DEP_NotFactory();
        _;
    }

    /**
     * @notice owner 可随时修改 factory
     */
    function setFactory(address f) external onlyOwner {
        if (f == address(0) || f.code.length == 0) revert DEP_InvalidFactory();
        emit FactoryChanged(factory, f);
        factory = f;
    }

    /**
     * @notice 可选：转移 owner
     */
    function transferOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert BM_ZeroAddress();
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @notice 部署合约（CREATE）
     */
    function deploy(bytes calldata initCode) external onlyFactory returns (address addr) {
        if (initCode.length == 0) revert BM_DeployFailed();

        assembly {
            let ptr := mload(0x40)
            let len := initCode.length
            calldatacopy(ptr, initCode.offset, len)
            addr := create(0, ptr, len)
        }
        if (addr == address(0)) revert BM_DeployFailed();
    }
}
