// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// BeamioFactoryPaymasterV07.sol
// - Deploy + init BeamioAccount (Route A)
// - Paymaster v0.7 (simple allow-list for BeamioAccount senders)
// - Relay entrypoints to BeamioAccount (paymaster pays gas)
// - Provides config views for module logic: quoteHelper / beamioUserCard / USDC

import "./BeamioTypesV07.sol";
import "./BeamioAccountDeployer.sol";
import "./BeamioAccount.sol";

contract BeamioFactoryPaymasterV07 is IPaymasterV07 {
	IEntryPointV07 public constant ENTRY_POINT =
		IEntryPointV07(0x0000000071727De22E5E9d8BAf0edAc6f37da032);

	BeamioAccountDeployer public deployer;

	// ========= registry =========
	mapping(address => bool) public isBeamioAccount;

	address public admin;

	mapping(address => uint256) public nextIndexOfCreator;
	mapping(address => address) public primaryAccountOf;
	mapping(address => address[]) internal accountsByCreator;

	address[] public payMasters;
	mapping(address => bool) public isPayMaster;

	uint256 public accountLimit;

	// ========= module/config =========
	address public containerModule;
	address public quoteHelper;
	address public beamioUserCard;
	address public USDC;

	// ========= events =========
	event AccountCreated(address indexed creator, address indexed account, uint256 index, bytes32 salt);
	event DeployerUpdated(address indexed oldDeployer, address indexed newDeployer);

	event ModuleUpdated(address indexed oldModule, address indexed newModule);
	event QuoteHelperUpdated(address indexed oldHelper, address indexed newHelper);
	event UserCardUpdated(address indexed oldCard, address indexed newCard);
	event USDCUpdated(address indexed oldUSDC, address indexed newUSDC);

	modifier onlyAdmin() {
		require(msg.sender == admin, "not admin");
		_;
	}

	modifier onlyPayMaster() {
		require(isPayMaster[msg.sender], "not payMaster");
		_;
	}

	modifier onlyEntryPoint() {
		require(msg.sender == address(ENTRY_POINT), "only entryPoint");
		_;
	}

	constructor(
		uint256 initialAccountLimit,
		address deployer_,
		address module_,
		address quoteHelper_,
		address userCard_,
		address usdc_
	) {
		require(initialAccountLimit > 0, "limit=0");
		require(deployer_ != address(0) && deployer_.code.length > 0, "bad deployer");
		require(module_ != address(0) && module_.code.length > 0, "bad module");
		require(quoteHelper_ != address(0) && quoteHelper_.code.length > 0, "bad helper");
		require(userCard_ != address(0) && userCard_.code.length > 0, "bad userCard");
		require(usdc_ != address(0), "bad usdc");

		admin = msg.sender;
		accountLimit = initialAccountLimit;

		isPayMaster[msg.sender] = true;
		payMasters.push(msg.sender);

		deployer = BeamioAccountDeployer(deployer_);
		emit DeployerUpdated(address(0), deployer_);
		try deployer.setFactory(address(this)) {} catch {}

		containerModule = module_;
		quoteHelper = quoteHelper_;
		beamioUserCard = userCard_;
		USDC = usdc_;
		emit ModuleUpdated(address(0), module_);
		emit QuoteHelperUpdated(address(0), quoteHelper_);
		emit UserCardUpdated(address(0), userCard_);
		emit USDCUpdated(address(0), usdc_);
	}


	// ===== admin ops =====
	function transferAdmin(address newAdmin) external onlyAdmin {
		require(newAdmin != address(0), "zero admin");
		admin = newAdmin;
	}

	function setAccountLimit(uint256 newLimit) external onlyAdmin {
		require(newLimit > 0 && newLimit <= 10000, "bad limit");
		accountLimit = newLimit;
	}

	function updateDeployer(address newDeployer) external onlyAdmin {
		require(newDeployer != address(0) && newDeployer.code.length > 0, "bad deployer");
		emit DeployerUpdated(address(deployer), newDeployer);
		deployer = BeamioAccountDeployer(newDeployer);
		try deployer.setFactory(address(this)) {} catch {}
	}

	function setModule(address newModule) external onlyAdmin {
		require(newModule != address(0) && newModule.code.length > 0, "bad module");
		emit ModuleUpdated(containerModule, newModule);
		containerModule = newModule;
	}

	function setQuoteHelper(address newHelper) external onlyAdmin {
		require(newHelper != address(0) && newHelper.code.length > 0, "bad helper");
		emit QuoteHelperUpdated(quoteHelper, newHelper);
		quoteHelper = newHelper;
	}

	function setUserCard(address newCard) external onlyAdmin {
		require(newCard != address(0) && newCard.code.length > 0, "bad card");
		emit UserCardUpdated(beamioUserCard, newCard);
		beamioUserCard = newCard;
	}

	function setUSDC(address newUSDC) external onlyAdmin {
		require(newUSDC != address(0), "bad usdc");
		emit USDCUpdated(USDC, newUSDC);
		USDC = newUSDC;
	}

	function getPayMasters() external view returns (address[] memory) {
		return payMasters;
	}

	function addPayMaster(address pm) external onlyAdmin {
		require(pm != address(0), "zero pm");
		require(!isPayMaster[pm], "already pm");
		isPayMaster[pm] = true;
		payMasters.push(pm);
	}

	function removePayMaster(address pm) external onlyAdmin {
		require(isPayMaster[pm], "not pm");
		require(payMasters.length > 1, "last pm");

		isPayMaster[pm] = false;

		uint256 len = payMasters.length;
		for (uint256 i = 0; i < len; i++) {
			if (payMasters[i] == pm) {
				payMasters[i] = payMasters[len - 1];
				payMasters.pop();
				break;
			}
		}
	}

	// ===== entrypoint deposit/withdraw =====
	function deposit() external payable onlyPayMaster {
		ENTRY_POINT.depositTo{value: msg.value}(address(this));
	}

	function withdrawTo(address payable to, uint256 amount) external onlyAdmin {
		ENTRY_POINT.withdrawTo(to, amount);
	}

	// ===== deterministic address =====
	function computeSalt(address creator, uint256 index) public pure returns (bytes32) {
		return keccak256(abi.encode(creator, index));
	}

	function _initCode() internal pure returns (bytes memory) {
		return abi.encodePacked(
			type(BeamioAccount).creationCode,
			abi.encode(ENTRY_POINT)
		);
	}

	function getAddress(address creator, uint256 index) public view returns (address) {
		// 直接计算地址，避免 Deployer.getAddress 的 ABI 解析问题
		bytes32 salt = computeSalt(creator, index);
		bytes memory initCode = _initCode();
		bytes32 initCodeHash = keccak256(initCode);
		bytes32 hash = keccak256(
			abi.encodePacked(bytes1(0xff), address(deployer), salt, initCodeHash)
		);
		return address(uint160(uint256(hash)));
	}

	function beamioAccountOf(address creator) external view returns (address) {
		return primaryAccountOf[creator];
	}

	function myBeamioAccounts() external view returns (address[] memory) {
		return accountsByCreator[msg.sender];
	}

	// ===== create account (EOA) =====
	function createAccount() external returns (address account) {
		address creator = msg.sender;
		uint256 index = nextIndexOfCreator[creator];
		require(index < accountLimit, "limit");

		account = getAddress(creator, index);
		nextIndexOfCreator[creator] = index + 1;

		if (account.code.length > 0) {
			if (!isBeamioAccount[account]) {
				isBeamioAccount[account] = true;
				accountsByCreator[creator].push(account);
			}
			if (primaryAccountOf[creator] == address(0)) primaryAccountOf[creator] = account;
			return account;
		}

		bytes32 salt = computeSalt(creator, index);
		account = deployer.deploy(salt, _initCode());

		// init: owner is also managers[0], threshold=1
		address[] memory managers = new address[](1);
		managers[0] = creator;

		BeamioAccount(payable(account)).initialize(
			creator,
			managers,
			1,
			address(this),
			containerModule
		);

		isBeamioAccount[account] = true;
		accountsByCreator[creator].push(account);
		if (primaryAccountOf[creator] == address(0)) primaryAccountOf[creator] = account;

		emit AccountCreated(creator, account, index, salt);
		return account;
	}

	// ===== create account for (paymaster) =====
	function createAccountFor(address creator) external onlyPayMaster returns (address account) {
		require(creator != address(0), "zero creator");

		uint256 index = nextIndexOfCreator[creator];
		require(index < accountLimit, "limit");

		account = getAddress(creator, index);
		nextIndexOfCreator[creator] = index + 1;

		if (account.code.length > 0) {
			if (!isBeamioAccount[account]) {
				isBeamioAccount[account] = true;
				accountsByCreator[creator].push(account);
			}
			if (primaryAccountOf[creator] == address(0)) primaryAccountOf[creator] = account;
			return account;
		}

		bytes32 salt = computeSalt(creator, index);
		account = deployer.deploy(salt, _initCode());

		address[] memory managers = new address[](1);
		managers[0] = creator;

		BeamioAccount(payable(account)).initialize(
			creator,
			managers,
			1,
			address(this),
			containerModule
		);

		isBeamioAccount[account] = true;
		accountsByCreator[creator].push(account);
		if (primaryAccountOf[creator] == address(0)) primaryAccountOf[creator] = account;

		emit AccountCreated(creator, account, index, salt);
		return account;
	}

	// ========= Paymaster (AA v0.7) =========
	function validatePaymasterUserOp(
		PackedUserOperation calldata userOp,
		bytes32,
		uint256
	) external override view onlyEntryPoint returns (bytes memory context, uint256 validationData) {
		if (!isBeamioAccount[userOp.sender]) {
			return ("", 1);
		}
		return ("", 0);
	}

	function postOp(PostOpMode, bytes calldata, uint256, uint256) external override onlyEntryPoint {
		// no-op
	}

	// =========================================================
	// Relay entrypoints (factory pays gas)
	// NOTE: BeamioAccount has receive() so use payable cast
	// =========================================================

	/// @notice to-bound owner relayed container
	function relayContainerMainRelayed(
		address account,
		address to,
		IBeamioContainerModuleV07.ContainerItem[] calldata items,
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external onlyPayMaster {
		require(isBeamioAccount[account], "not beamio account");
		BeamioAccount(payable(account)).containerMainRelayed(to, items, nonce_, deadline_, sig);
	}

	/// @notice open relayed (no-to signature) submitted via factory only
	function relayContainerMainRelayedOpen(
		address account,
		address to,
		IBeamioContainerModuleV07.ContainerItem[] calldata items,
		address token,
		uint8 currencyType,
		uint256 maxAmount,
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external onlyPayMaster {
		require(isBeamioAccount[account], "not beamio account");
		BeamioAccount(payable(account)).containerMainRelayedOpen(to, items, token, currencyType, maxAmount, nonce_, deadline_, sig);
	}

	/// @notice view-only simulation for client preflight (eth_call)
	function simulateRelayOpen(
		address account,
		address to,
		IBeamioContainerModuleV07.ContainerItem[] calldata items,
		address token,
		uint8 currencyType,
		uint256 maxAmount,
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external view returns (bool ok, string memory reason) {
		if (!isBeamioAccount[account]) return (false, "not beamio account");
		return BeamioAccount(payable(account)).simulateOpenContainer(to, items, token, currencyType, maxAmount, nonce_, deadline_, sig);
	}

	// ===== Redeem relays =====
	function relayCreateRedeem(
		address account,
		bytes32 passwordHash,
		address to,
		IBeamioContainerModuleV07.ContainerItem[] calldata items,
		uint64 expiry
	) external onlyPayMaster {
		require(isBeamioAccount[account], "not beamio account");
		BeamioAccount(payable(account)).createRedeem(passwordHash, to, items, expiry);
	}

	function relayCancelRedeem(address account, bytes32 passwordHash) external onlyPayMaster {
		require(isBeamioAccount[account], "not beamio account");
		BeamioAccount(payable(account)).cancelRedeem(passwordHash);
	}

	function relayRedeem(address account, string calldata password, address to) external onlyPayMaster {
		require(isBeamioAccount[account], "not beamio account");
		BeamioAccount(payable(account)).redeem(password, to);
	}

	// ===== Faucet pool relays =====
	function relayCreateFaucetPool(
		address account,
		bytes32 passwordHash,
		uint32 totalCount,
		uint64 expiry,
		IBeamioContainerModuleV07.ContainerItem[] calldata items
	) external onlyPayMaster {
		require(isBeamioAccount[account], "not beamio account");
		BeamioAccount(payable(account)).createFaucetPool(passwordHash, totalCount, expiry, items);
	}

	function relayCancelFaucetPool(address account, bytes32 passwordHash) external onlyPayMaster {
		require(isBeamioAccount[account], "not beamio account");
		BeamioAccount(payable(account)).cancelFaucetPool(passwordHash);
	}

	function relayFaucetRedeemPool(
		address account,
		string calldata password,
		address claimer,
		address to,
		IBeamioContainerModuleV07.ContainerItem[] calldata items
	) external onlyPayMaster {
		require(isBeamioAccount[account], "not beamio account");
		BeamioAccount(payable(account)).faucetRedeemPool(password, claimer, to, items);
	}

	receive() external payable {}
}
