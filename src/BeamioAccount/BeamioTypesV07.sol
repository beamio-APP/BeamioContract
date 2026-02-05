// SPDX-License-Identifier: MIT
//  BeamioTypesV07.sol
pragma solidity ^0.8.20;

interface IPaymasterV07 {
    enum PostOpMode { opSucceeded, opReverted, postOpReverted }

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external;
}

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

struct TransferInfo {
    bool isXfer;
    address token;
    address to;
    uint256 amt;
    bytes4 sel;
    uint256 tokenId;
    bool hasTokenId;
}

interface IEntryPointV07 {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;
    function balanceOf(address account) external view returns (uint256);
}

interface IAccountV07 {
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256);
}

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

interface IERC1155Like {
	function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
	function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata data) external;
}

bytes32 constant CONTAINER1155_TYPEHASH =
    keccak256(
        "RelayedContainer1155(address token,address to,bytes32 idsHash,bytes32 amountsHash,bytes32 datasHash,uint256 nonce,uint256 deadline)"
    );


interface IERC20Like {
	function transfer(address to, uint256 amount) external returns (bool);
	function transferFrom(address from, address to, uint256 amount) external returns (bool);
	function balanceOf(address a) external view returns (uint256);
	function allowance(address a, address spender) external view returns (uint256);
}


struct RelayContainerParams {
    address to;
    address[] assets;
    uint256[] amounts;
    uint256 deadline;
}

struct RelayContainer1155Params {
    address token;
    address to;
    uint256[] ids;
    uint256[] amounts;
    bytes[] datas;
    uint256 deadline;
}

    error NotOwner();
    error NotFactory();
    error AlreadyInitialized();
    error ZeroAddress();
    error SigExpired();
    error BadSig();
    error Unsupported();
	error LenMismatch();

    error NotAuthorized();
    error NotEntryPoint();
    error Expired();
    error BadNonce();

    error EmptyContainer();
    error ERC20TransferFailed();
    error ERC1155TransferFailed();
    error PaymasterNotAllowed();


	event ERC1155ContainerTransferred(address indexed to, address indexed token, uint256 count);