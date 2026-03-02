// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/utils/cryptography/ECDSA.sol";
import "../contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title MerchantPOSManagement
 * @notice 商家 manager 管理自己钱包下的 POS 机列表，POS 机使用 EOA 钱包地址。
 *         支持 manager 离线签字，由代付 endpoint 提交。
 */
contract MerchantPOSManagement {
    // ========== Errors ==========
    error POSAlreadyRegistered();
    error POSNotRegistered();
    error POSRegisteredByOther();
    error InvalidAddress();
    error SignatureExpired();
    error InvalidSignature();
    error NonceUsed();

    // ========== EIP-712 ==========
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant REGISTER_POS_TYPEHASH = keccak256(
        "RegisterPOS(address merchant,address pos,uint256 deadline,bytes32 nonce)"
    );
    bytes32 private constant REMOVE_POS_TYPEHASH = keccak256(
        "RemovePOS(address merchant,address pos,uint256 deadline,bytes32 nonce)"
    );
    bytes32 private immutable _domainSeparator;

    /// @notice 已使用的 nonce，防重放
    mapping(bytes32 => bool) public usedNonces;

    constructor() {
        _domainSeparator = keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            keccak256(bytes("MerchantPOSManagement")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    // ========== Storage ==========
    /// @notice merchant => POS 地址 => 是否已登记
    mapping(address => mapping(address => bool)) private _isPOSRegistered;

    /// @notice merchant => POS 地址列表（用于枚举）
    mapping(address => address[]) private _merchantPOSList;

    /// @notice merchant => POS => 在列表中的索引（1-based，0 表示未登记），用于 O(1) 删除
    mapping(address => mapping(address => uint256)) private _posIndex;

    /// @notice POS 地址 => 所属 merchant（一个 POS 只能被一个商家登记）
    mapping(address => address) private _posToMerchant;

    // ========== Events ==========
    event POSRegistered(address indexed merchant, address indexed pos);
    event POSRemoved(address indexed merchant, address indexed pos);

    // ========== External ==========

    /**
     * @notice 登记 POS 机
     * @param pos POS 机的 EOA 钱包地址
     */
    function registerPOS(address pos) external {
        if (pos == address(0)) revert InvalidAddress();
        address merchant = msg.sender;

        if (_isPOSRegistered[merchant][pos]) revert POSAlreadyRegistered();
        address currentOwner = _posToMerchant[pos];
        if (currentOwner != address(0) && currentOwner != merchant) revert POSRegisteredByOther();

        _isPOSRegistered[merchant][pos] = true;
        _posToMerchant[pos] = merchant;
        _merchantPOSList[merchant].push(pos);
        _posIndex[merchant][pos] = _merchantPOSList[merchant].length; // 1-based

        emit POSRegistered(merchant, pos);
    }

    /**
     * @notice 删除 POS 机
     * @param pos POS 机的 EOA 钱包地址
     */
    function removePOS(address pos) external {
        address merchant = msg.sender;
        if (!_isPOSRegistered[merchant][pos]) revert POSNotRegistered();

        uint256 idx = _posIndex[merchant][pos];
        uint256 len = _merchantPOSList[merchant].length;

        if (idx != len) {
            // 非最后一个：与最后一个交换后 pop
            address lastPos = _merchantPOSList[merchant][len - 1];
            _merchantPOSList[merchant][idx - 1] = lastPos;
            _posIndex[merchant][lastPos] = idx;
        }
        _merchantPOSList[merchant].pop();

        delete _posIndex[merchant][pos];
        _isPOSRegistered[merchant][pos] = false;
        delete _posToMerchant[pos];

        emit POSRemoved(merchant, pos);
    }

    /**
     * @notice 由 manager 离线签字登记 POS，代付 endpoint 提交。任何人可调用。
     * @param merchant 商家 manager 的 EOA 地址（签字者）
     * @param pos POS 机的 EOA 地址
     * @param deadline 签名过期时间戳（秒）
     * @param nonce 防重放随机数
     * @param signature manager 的 EIP-712 签名
     */
    function registerPOSBySignature(
        address merchant,
        address pos,
        uint256 deadline,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (pos == address(0)) revert InvalidAddress();
        if (block.timestamp > deadline) revert SignatureExpired();

        bytes32 nonceKey = keccak256(abi.encode(merchant, nonce));
        if (usedNonces[nonceKey]) revert NonceUsed();
        usedNonces[nonceKey] = true;

        bytes32 structHash = keccak256(abi.encode(REGISTER_POS_TYPEHASH, merchant, pos, deadline, nonce));
        bytes32 digest = MessageHashUtils.toTypedDataHash(_domainSeparator, structHash);
        address signer = ECDSA.recoverCalldata(digest, signature);
        if (signer != merchant) revert InvalidSignature();

        if (_isPOSRegistered[merchant][pos]) revert POSAlreadyRegistered();
        address currentOwner = _posToMerchant[pos];
        if (currentOwner != address(0) && currentOwner != merchant) revert POSRegisteredByOther();

        _isPOSRegistered[merchant][pos] = true;
        _posToMerchant[pos] = merchant;
        _merchantPOSList[merchant].push(pos);
        _posIndex[merchant][pos] = _merchantPOSList[merchant].length;

        emit POSRegistered(merchant, pos);
    }

    /**
     * @notice 由 manager 离线签字删除 POS，代付 endpoint 提交。任何人可调用。
     * @param merchant 商家 manager 的 EOA 地址（签字者）
     * @param pos POS 机的 EOA 地址
     * @param deadline 签名过期时间戳（秒）
     * @param nonce 防重放随机数
     * @param signature manager 的 EIP-712 签名
     */
    function removePOSBySignature(
        address merchant,
        address pos,
        uint256 deadline,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert SignatureExpired();

        bytes32 nonceKey = keccak256(abi.encode(merchant, nonce));
        if (usedNonces[nonceKey]) revert NonceUsed();
        usedNonces[nonceKey] = true;

        bytes32 structHash = keccak256(abi.encode(REMOVE_POS_TYPEHASH, merchant, pos, deadline, nonce));
        bytes32 digest = MessageHashUtils.toTypedDataHash(_domainSeparator, structHash);
        address signer = ECDSA.recoverCalldata(digest, signature);
        if (signer != merchant) revert InvalidSignature();

        if (!_isPOSRegistered[merchant][pos]) revert POSNotRegistered();

        uint256 idx = _posIndex[merchant][pos];
        uint256 len = _merchantPOSList[merchant].length;

        if (idx != len) {
            address lastPos = _merchantPOSList[merchant][len - 1];
            _merchantPOSList[merchant][idx - 1] = lastPos;
            _posIndex[merchant][lastPos] = idx;
        }
        _merchantPOSList[merchant].pop();

        delete _posIndex[merchant][pos];
        _isPOSRegistered[merchant][pos] = false;
        delete _posToMerchant[pos];

        emit POSRemoved(merchant, pos);
    }

    // ========== View ==========

    /**
     * @notice 获取商家的 POS 列表
     * @param merchant 商家 EOA 地址
     */
    function getMerchantPOSList(address merchant) external view returns (address[] memory) {
        return _merchantPOSList[merchant];
    }

    /**
     * @notice 检查 POS 是否已登记在该商家下
     * @param merchant 商家 EOA 地址
     * @param pos POS 的 EOA 地址
     */
    function isPOSRegistered(address merchant, address pos) external view returns (bool) {
        return _isPOSRegistered[merchant][pos];
    }

    /**
     * @notice 获取 POS 所属的商家（address(0) 表示未登记）
     * @param pos POS 的 EOA 地址
     */
    function getPOSMerchant(address pos) external view returns (address) {
        return _posToMerchant[pos];
    }

    /**
     * @notice 获取商家的 POS 数量
     * @param merchant 商家 EOA 地址
     */
    function getMerchantPOSCount(address merchant) external view returns (uint256) {
        return _merchantPOSList[merchant].length;
    }

    /**
     * @notice 获取 EIP-712 domain separator，供前端/代付 endpoint 构造签名
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator;
    }

    /**
     * @notice 获取 EIP-712 签名域，供 eth_signTypedData_v4
     * @dev Manager 离线签字时使用：
     *   domain: { name: "MerchantPOSManagement", version: "1", chainId, verifyingContract }
     *   types: { RegisterPOS: [{ name: "merchant", type: "address" }, { name: "pos", type: "address" }, { name: "deadline", type: "uint256" }, { name: "nonce", type: "bytes32" }] }
     *   types: { RemovePOS: [...] }  // 同上
     */
    function eip712Domain() external view returns (
        string memory name,
        string memory version,
        uint256 chainId,
        address verifyingContract
    ) {
        return (
            "MerchantPOSManagement",
            "1",
            block.chainid,
            address(this)
        );
    }
}
