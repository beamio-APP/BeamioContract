// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// BeamioAccount.sol (Route A)
// - Account delegatecall -> BeamioContainerModuleV07 (address comes from FactoryPaymasterV07)
// - Module state (nonces / reserves / redeem / pool) lives in Account storage via fixed-slot layout
// - Emits core events here; container events emitted in Module ONLY

import "./BeamioTypesV07.sol";
import "../contracts/utils/cryptography/ECDSA.sol";
import "../contracts/utils/cryptography/MessageHashUtils.sol";
import "../contracts/token/ERC1155/utils/ERC1155Holder.sol";


interface IBeamioAccountFactoryConfigV2 {
  function containerModule() external view returns (address);
  function quoteHelper() external view returns (address);
  function beamioUserCard() external view returns (address);
  function USDC() external view returns (address);
}

interface IBeamioContainerModuleV07 {
	// MUST match layout used by client and module
	enum AssetKind { ERC20, ERC1155 }
	struct ContainerItem {
		AssetKind kind;
		address asset;
		uint256 amount;
		uint256 tokenId;
		bytes data;
	}

	// to-bound owner relayed (existing)
	function containerMainRelayed(
		address to,
		ContainerItem[] calldata items,
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external;

	// open relayed (no-to signature)  ✅ token 参数已移除（按你最新规则）
	function containerMainRelayedOpen(
		address to,
		ContainerItem[] calldata items,
		uint8 currencyType,
		uint256 maxAmount,
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external;

	function simulateOpenContainer(
		address to,
		ContainerItem[] calldata items,
		uint8 currencyType,
		uint256 maxAmount,
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external view returns (bool ok, string memory reason);

	// redeem single-use password
	function createRedeem(
		bytes32 passwordHash,
		address to,
		ContainerItem[] calldata items,
		uint64 expiry
	) external;

	function cancelRedeem(string calldata code) external;

	function redeem(
		string calldata password,
		address to
	) external;

	// redeem pool (faucet)
	function createFaucetPool(
		bytes32 passwordHash,
		uint32 totalCount,
		uint64 expiry,
		ContainerItem[] calldata items
	) external;

	function cancelFaucetPool(string calldata code) external;

	function faucetRedeemPool(
		string calldata password,
		address claimer,
		address to,
		ContainerItem[] calldata items
	) external;

	// nonces views (stored in module-layout)
	function relayedNonce() external view returns (uint256);
	function openRelayedNonce() external view returns (uint256);

	// reserve gate: 在 execute 前校验，防止 owner 通过 AA 路径转出被 lock 的资产
	function preExecuteCheck(address dest, uint256 value, bytes calldata func) external view;
}

contract BeamioAccount is ERC1155Holder, IAccountV07, IERC1271 {
	using ECDSA for bytes32;
	using MessageHashUtils for bytes32;

	// =========================================================
	// Core roles (owner immutable after initialize)
	// =========================================================
	address public owner;                 // immutable after initialize (no changeOwner)
	address public factory;               // privileged relay caller + paymaster binding
	IEntryPointV07 public immutable entryPoint;

	// =========================================================
	// Threshold managers (AA policy)
	// owner must be thresholdManagers[0] forever
	// =========================================================
	mapping(address => bool) public isThresholdManager;
	address[] public thresholdManagers;   // strictly sorted
	uint256 public threshold;             // >=1 and <= managers.length

	bool private initialized;

	// =========================================================
	// Events
	// =========================================================
	event Initialized(address indexed owner, address indexed factory, address entryPoint);
	event FactoryUpdated(address indexed oldFactory, address indexed newFactory);
	event ThresholdPolicyUpdated(bytes32 indexed managersHash, uint256 threshold);

	modifier onlyOwnerDirect() {
		if (msg.sender != owner) revert NotAuthorized();
		_;
	}

	modifier onlyFactory() {
		if (msg.sender != factory) revert NotFactory();
		_;
	}

	modifier onlyEntryPoint() {
		if (msg.sender != address(entryPoint)) revert NotEntryPoint();
		_;
	}

	constructor(IEntryPointV07 ep) {
		entryPoint = ep;
	}

	// =========================================================
	// Initialize (one-time)
	// =========================================================
	function initialize(
		address _owner,
		address[] calldata managersSorted,
		uint256 _threshold,
		address _factory
	) external {
		if (initialized) revert AlreadyInitialized();
		if (_owner == address(0)) revert ZeroAddress();
		if (_factory == address(0) || _factory.code.length == 0) revert ZeroAddress();

		if (managersSorted.length == 0) revert NotAuthorized();
		if (managersSorted[0] != _owner) revert NotAuthorized();
		if (_threshold == 0 || _threshold > managersSorted.length) revert NotAuthorized();

		initialized = true;
		owner = _owner;
		factory = _factory;

		emit Initialized(_owner, _factory, address(entryPoint));
		emit FactoryUpdated(address(0), _factory);

		_setThresholdManagersInternal(managersSorted, _threshold);
	}

	function setFactory(address newFactory) external onlyFactory {
		if (newFactory == address(0) || newFactory.code.length == 0) revert ZeroAddress();
		emit FactoryUpdated(factory, newFactory);
		factory = newFactory;
	}

	/// @notice Update AA policy (must be executed via AA path: EntryPoint -> execute calling this)
	function setThresholdPolicy(address[] calldata managersSorted, uint256 newThreshold) external onlyEntryPoint {
		_setThresholdManagersInternal(managersSorted, newThreshold);
	}

	function _setThresholdManagersInternal(address[] calldata managersSorted, uint256 newThreshold) internal {
		if (managersSorted.length == 0) revert NotAuthorized();
		if (managersSorted[0] != owner) revert NotAuthorized();

		for (uint256 i = 0; i < thresholdManagers.length; i++) {
			isThresholdManager[thresholdManagers[i]] = false;
		}
		delete thresholdManagers;

		address last = address(0);
		for (uint256 i = 0; i < managersSorted.length; i++) {
			address m = managersSorted[i];
			if (m == address(0) || m <= last) revert NotAuthorized();
			last = m;
			isThresholdManager[m] = true;
			thresholdManagers.push(m);
		}

		if (newThreshold == 0 || newThreshold > thresholdManagers.length) revert NotAuthorized();
		threshold = newThreshold;

		emit ThresholdPolicyUpdated(keccak256(abi.encode(thresholdManagers)), threshold);
	}

	// 在 BeamioAccount.sol 里加更细的错误
	error PMD_TooShort(uint256 len);
	error PMD_BadPaymaster(address got, address expected);

	// =========================================================
	// ERC-4337 validateUserOp (thresholdManagers multisig)
	// =========================================================
	function validateUserOp(
		PackedUserOperation calldata userOp,
		bytes32 userOpHash,
		uint256 missingAccountFunds
	) external override onlyEntryPoint returns (uint256 validationData) {
		// bind paymaster to factory (recommended)
		if (factory != address(0) && userOp.paymasterAndData.length > 0) {
			bytes calldata pnd = userOp.paymasterAndData;
			if (pnd.length < 20) revert PMD_TooShort(pnd.length);

			address pm;
			assembly {
				pm := shr(96, calldataload(pnd.offset))
			}
			if (pm != factory) revert PMD_BadPaymaster(pm, factory);
		}

		if (!_checkThresholdManagersEthSign(userOpHash, userOp.signature)) {
			return 1; // SIG_VALIDATION_FAILED
		}

		if (missingAccountFunds > 0) {
			(bool ok, ) = payable(address(entryPoint)).call{value: missingAccountFunds}("");
			ok;
		}

		return 0;
	}

	function _checkThresholdManagersEthSign(bytes32 hash, bytes calldata sigs) internal view returns (bool) {
		if (!initialized || threshold == 0) return false;
		if (sigs.length % 65 != 0) return false;

		uint256 n = sigs.length / 65;
		if (n < threshold) return false;

		bytes32 ethHash = hash.toEthSignedMessageHash();

		address lastSigner = address(0);
		uint256 okCount = 0;

		for (uint256 i = 0; i < n; i++) {
			uint256 off = i * 65;

			bytes32 r;
			bytes32 s;
			uint8 v;

			assembly {
				r := calldataload(add(sigs.offset, off))
				s := calldataload(add(sigs.offset, add(off, 32)))
				v := byte(0, calldataload(add(sigs.offset, add(off, 64))))
			}

			if (v < 27) v += 27;

			address signer = ECDSA.recover(ethHash, v, r, s);

			if (signer <= lastSigner) return false;
			lastSigner = signer;

			if (isThresholdManager[signer]) {
				okCount++;
				if (okCount >= threshold) return true;
			}
		}
		return false;
	}

	function isValidSignature(bytes32 hash, bytes calldata signature)
		external
		view
		override
		returns (bytes4)
	{
		if (!_checkThresholdManagersEthSign(hash, signature)) return 0xffffffff;
		return 0x1626ba7e;
	}

	// =========================================================
	// EntryPoint execution (AA path)
	// =========================================================
	function execute(address dest, uint256 value, bytes calldata func) external onlyEntryPoint {
		if (dest == address(0)) revert ZeroAddress();
		_delegate(abi.encodeWithSelector(
			IBeamioContainerModuleV07.preExecuteCheck.selector,
			dest, value, func
		));
		(bool ok, bytes memory ret) = dest.call{value: value}(func);
		if (!ok) {
			assembly { revert(add(ret, 0x20), mload(ret)) }
		}
	}

	function executeBatch(
		address[] calldata dest,
		uint256[] calldata value,
		bytes[] calldata func
	) external onlyEntryPoint {
		uint256 n = dest.length;
		if (n != value.length || n != func.length) revert LenMismatch();

		for (uint256 i = 0; i < n; i++) {
			if (dest[i] == address(0)) revert ZeroAddress();
			_delegate(abi.encodeWithSelector(
				IBeamioContainerModuleV07.preExecuteCheck.selector,
				dest[i], value[i], func[i]
			));
			(bool ok, bytes memory ret) = dest[i].call{value: value[i]}(func[i]);
			if (!ok) {
				assembly { revert(add(ret, 0x20), mload(ret)) }
			}
		}
	}

	// =========================================================
	// Module resolution (GLOBAL from Factory)
	// =========================================================
	function _module() internal view returns (address m) {
		address f = factory;
		if (f == address(0) || f.code.length == 0) revert ZeroAddress();
		m = IBeamioAccountFactoryConfigV2(f).containerModule();
		if (m == address(0) || m.code.length == 0) revert ZeroAddress();
	}

	// =========================================================
	// Delegatecall dispatch to Module (container / redeem / pool)
	// =========================================================
	function _delegate(bytes memory cdata) internal returns (bytes memory ret) {
		address m = _module();
		(bool ok, bytes memory out) = m.delegatecall(cdata);
		if (!ok) {
			assembly {
				revert(add(out, 0x20), mload(out))
			}
		}
		return out;
	}

	function _staticDelegate(bytes memory cdata) internal view returns (bytes memory ret) {
		address m = _module();
		(bool ok, bytes memory out) = m.staticcall(abi.encodePacked(cdata, address(this)));
		if (!ok) {
			assembly {
				revert(add(out, 0x20), mload(out))
			}
		}
		return out;
	}

	// --- to-bound owner relayed container (factory pays gas) ---
	function containerMainRelayed(
		address to,
		IBeamioContainerModuleV07.ContainerItem[] calldata items,
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external onlyFactory {
		_delegate(abi.encodeWithSelector(
			IBeamioContainerModuleV07.containerMainRelayed.selector,
			to, items, nonce_, deadline_, sig
		));
	}

	// --- open relayed container (no-to signature; module enforces all rules) ---
	function containerMainRelayedOpen(
		address to,
		IBeamioContainerModuleV07.ContainerItem[] calldata items,
		uint8 currencyType,
		uint256 maxAmount,
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external onlyFactory {
		_delegate(abi.encodeWithSelector(
			IBeamioContainerModuleV07.containerMainRelayedOpen.selector,
			to, items, currencyType, maxAmount, nonce_, deadline_, sig
		));
	}

	// --- view-only simulation for open container (eth_call) ---
	function simulateOpenContainer(
		address to,
		IBeamioContainerModuleV07.ContainerItem[] calldata items,
		uint8 currencyType,
		uint256 maxAmount,
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external view returns (bool ok, string memory reason) {
		bytes memory out = _staticDelegate(abi.encodeWithSelector(
			IBeamioContainerModuleV07.simulateOpenContainer.selector,
			to, items, currencyType, maxAmount, nonce_, deadline_, sig
		));
		return abi.decode(out, (bool, string));
	}

	/// @notice Factory 代付 gas 时调用，执行 owner 签名的 module calldata（createRedeem、cancelRedeem、createFaucetPool、cancelFaucetPool 等）
	function executeFromFactory(bytes calldata data) external onlyFactory {
		_delegate(data);
	}

	// --- redeem single-use password ---
	function createRedeem(bytes32 passwordHash, address to, IBeamioContainerModuleV07.ContainerItem[] calldata items, uint64 expiry)
		external
		onlyOwnerDirect
	{
		_delegate(abi.encodeWithSelector(
			IBeamioContainerModuleV07.createRedeem.selector,
			passwordHash, to, items, expiry
		));
	}

	function cancelRedeem(string calldata code) external onlyOwnerDirect {
		_delegate(abi.encodeWithSelector(
			IBeamioContainerModuleV07.cancelRedeem.selector,
			code
		));
	}

	function redeem(string calldata password, address to) external {
		_delegate(abi.encodeWithSelector(
			IBeamioContainerModuleV07.redeem.selector,
			password, to
		));
	}

	// --- faucet pool ---
	function createFaucetPool(bytes32 passwordHash, uint32 totalCount, uint64 expiry, IBeamioContainerModuleV07.ContainerItem[] calldata items)
		external
		onlyOwnerDirect
	{
		_delegate(abi.encodeWithSelector(
			IBeamioContainerModuleV07.createFaucetPool.selector,
			passwordHash, totalCount, expiry, items
		));
	}

	function cancelFaucetPool(string calldata code) external onlyOwnerDirect {
		_delegate(abi.encodeWithSelector(
			IBeamioContainerModuleV07.cancelFaucetPool.selector,
			code
		));
	}

	function faucetRedeemPool(string calldata password, address claimer, address to, IBeamioContainerModuleV07.ContainerItem[] calldata items) external {
		_delegate(abi.encodeWithSelector(
			IBeamioContainerModuleV07.faucetRedeemPool.selector,
			password, claimer, to, items
		));
	}

	// --- nonces view passthrough ---
	function relayedNonce() external view returns (uint256) {
		bytes memory out = _staticDelegate(abi.encodeWithSelector(IBeamioContainerModuleV07.relayedNonce.selector));
		return abi.decode(out, (uint256));
	}

	function openRelayedNonce() external view returns (uint256) {
		bytes memory out = _staticDelegate(abi.encodeWithSelector(IBeamioContainerModuleV07.openRelayedNonce.selector));
		return abi.decode(out, (uint256));
	}

	// =========================================================
	// ERC1155 receiver support
	// =========================================================
	function supportsInterface(bytes4 interfaceId)
		public
		view
		override(ERC1155Holder)
		returns (bool)
	{
		return super.supportsInterface(interfaceId);
	}

	receive() external payable {}
}
