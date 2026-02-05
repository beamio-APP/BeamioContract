// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BeamioERC1155Logic.sol";
import "./BeamioCurrency.sol";
import "./Errors.sol";

import "../contracts/token/ERC1155/ERC1155.sol";
import "../contracts/access/Ownable.sol";
import "../contracts/utils/ReentrancyGuard.sol";
import "../contracts/utils/cryptography/ECDSA.sol";
import "../contracts/utils/cryptography/MessageHashUtils.sol";

/* =========================
   Interfaces
   ========================= */
// 注意：IERC3009BytesSig, IBeamioFactoryOracle, IBeamioAccountFactoryV07 已在 BeamioERC1155Logic.sol 中定义

interface IBeamioGatewayAAFactoryGetter {
    function _aaFactory() external view returns (address);
}

interface IBeamioUserCardFactoryPaymasterV07 {
    function defaultRedeemModule() external view returns (address);
}

/**
 * @dev RedeemModule VNext ABI (delegatecall target)
 */
interface IBeamioRedeemModuleVNext {
    function createRedeem(
        bytes32 hash,
        uint256 points6,
        uint256 attr,
        uint64 validAfter,
        uint64 validBefore,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) external;

    function cancelRedeem(string calldata code) external;

    function consumeRedeem(string calldata code, address to)
        external
        returns (uint256 points6, uint256 attr, uint256[] memory tokenIds, uint256[] memory amounts);

    function createRedeemPool(
        bytes32 poolHash,
        uint64 validAfter,
        uint64 validBefore,
        uint256[][] calldata tokenIdsList,
        uint256[][] calldata amountsList,
        uint32[] calldata counts
    ) external;

    function terminateRedeemPool(bytes32 poolHash) external;

    function consumeRedeemPool(string calldata code, address user)
        external
        returns (uint256[] memory tokenIds, uint256[] memory amounts);
}

/* =========================
   OpenAuth
   ========================= */

struct OpenAuthParams {
    address fromEOA;
    address toEOA;
    uint256 id;
    uint256 amount;
    uint256 maxAmount;
    uint256 validAfter;
    uint256 validBefore;
    bytes32 nonce;
}

/* =========================================================
   BeamioUserCard
   ========================================================= */

contract BeamioUserCard is ERC1155, Ownable, ReentrancyGuard {
    using BeamioCurrency for *;
    using ECDSA for bytes32;

    // ===== Versioning =====
    uint256 public constant VERSION = 10;

    // ===== Constants (no magic numbers) =====
    uint256 public constant POINTS_ID = BeamioERC1155Logic.POINTS_ID;
    uint8 public constant POINTS_DECIMALS = BeamioERC1155Logic.POINTS_DECIMALS;
    uint256 private constant POINTS_ONE = 10 ** uint256(POINTS_DECIMALS);

    uint256 public constant NFT_START_ID = BeamioERC1155Logic.NFT_START_ID;
    uint256 public constant ISSUED_NFT_START_ID = BeamioERC1155Logic.ISSUED_NFT_START_ID;

    // ===== Immutable / gateway =====
    address public immutable deployer;
    address public gateway;
    address public debugGateway; // allow debug override

    function factoryGateway() public view returns (address) {
        return gateway;
    }

    modifier onlyAuthorizedGateway() {
        address gw = debugGateway == address(0) ? gateway : debugGateway;
        if (msg.sender != gw) revert UC_UnauthorizedGateway();
        _;
    }

    // ===== Pricing =====
    BeamioCurrency.CurrencyType public currency;
    /// @dev 单价：每 1e6 points 的价格，货币单位 E6（与购买时 USDC 1e6 一致）
    uint256 public pointsUnitPriceInCurrencyE6;

    // ===== per-card expiry policy =====
    uint256 public expirySeconds; // 0 = never expire
    event ExpirySecondsUpdated(uint256 oldSecs, uint256 newSecs);
    event PointsUnitPriceUpdated(uint256 priceInCurrencyE6);

    // ===== multisig governance =====
    uint256 public threshold;
    mapping(address => bool) public isAdmin;
    address[] public adminList;

    struct Proposal {
        address target;
        uint256 v1;
        uint256 v2;
        uint256 v3;
        bytes4 selector;
        uint256 approvals;
        bool executed;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public isApproved;
    uint256 public proposalCount;

    event ProposalCreated(uint256 indexed id, bytes4 indexed selector, address indexed proposer);
    event ProposalApproved(uint256 indexed id, address indexed admin);
    event ProposalExecuted(uint256 indexed id);

    modifier onlyAdmin() {
        if (!isAdmin[msg.sender]) revert UC_NotAdmin();
        _;
    }

    // ===== whitelist =====
    mapping(address => bool) public transferWhitelist;
    bool public transferWhitelistEnabled;
    event TransferWhitelistEnabledUpdated(bool enabled);

    function _setTransferWhitelistEnabled(bool enabled) internal {
        transferWhitelistEnabled = enabled;
        emit TransferWhitelistEnabledUpdated(enabled);
    }

    function setTransferWhitelistEnabled(bool enabled) external onlyAdmin {
        _setTransferWhitelistEnabled(enabled);
    }

    // ===== membership state =====
    mapping(uint256 => uint256) public expiresAt;
    mapping(uint256 => uint256) public attributes;
    mapping(uint256 => uint256) public tokenTierIndexOrMax;
    mapping(address => uint256[]) public _userOwnedNfts;

    mapping(address => uint256) public activeMembershipId;
    mapping(address => uint256) public activeTierIndexOrMax;

    struct NFTDetail {
        uint256 tokenId;
        uint256 attribute;
        uint256 tierIndexOrMax;
        uint256 expiry;
        bool isExpired;
    }

    // ===== tiers =====
    struct Tier {
        uint256 minUsdc6; // semantic: minPointsDelta6
        uint256 attr;
    }
    Tier[] public tiers;
    uint256 public defaultAttrWhenNoTiers;

    event TiersUpdated(uint256 count);
    event TierAppended(uint256 index, uint256 minUsdc6, uint256 attr);
    event DefaultAttrUpdated(uint256 attr);

    event MemberNFTIssued(address indexed user, uint256 indexed tokenId, uint256 tierIndexOrMax, uint256 minUsdc6, uint256 expiry);
    event MemberNFTUpgraded(address indexed user, uint256 indexed oldActiveTokenId, uint256 indexed newTokenId, uint256 oldTierIndexOrMax, uint256 newTierIndex, uint256 newExpiry);

    event PointsPurchasedWithUSDC(
        address indexed payerEOA,
        address indexed beneficiaryAccount,
        address indexed usdc,
        uint256 usdcIn6,
        uint256 pointsMinted6,
        uint256 unitPointPriceUsdc6,
        bytes32 nonce
    );

    event AdminCardMinted(address indexed beneficiaryAccount, uint256 indexed tokenId, uint256 attr, uint256 expiry);
    event AdminPointsMinted(address indexed beneficiaryAccount, uint256 points6);

    // ===== Faucet data =====
    struct FaucetConfig {
        uint64 validUntil;
        uint64 perClaimMax;
        uint128 maxPerUser;
        uint128 maxGlobal;
        bool enabled;

        uint8 currency;
        uint8 decimals;           // MUST be POINTS_DECIMALS
        uint128 priceInCurrency6; // 0 free; >0 priced
    }

    mapping(uint256 => FaucetConfig) public faucetConfig;
    mapping(uint256 => mapping(address => uint256)) public faucetClaimed;
    mapping(uint256 => uint256) public faucetGlobalMinted;
    mapping(uint256 => bool) public faucetConfigFrozen;

    event FaucetConfigUpdated(uint256 indexed id, FaucetConfig cfg);
    event FaucetClaimed(uint256 indexed id, address indexed userEOA, address indexed acct, uint256 amount, uint256 claimedAfter);

    // ===== current index =====
    uint256 private _currentIndex = NFT_START_ID;

    // ===== Open authorization (points transfer) =====
    mapping(bytes32 => bool) public openAuthUsed;

    event OpenTransferAuthorized(
        address indexed fromEOA,
        address indexed fromAccount,
        uint256 indexed id,
        uint256 amount,
        uint256 maxAmount,
        bytes32 nonce,
        address toAccount
    );

    // ===== Redeem Events (emitted by card; module also emits its own) =====
    event RedeemCreated(bytes32 indexed hash, uint256 points6, uint256 attr);
    event RedeemCancelled(bytes32 indexed hash);

    // ==========================================================
    // ctor
    // ==========================================================
    constructor(
        string memory uri_,
        BeamioCurrency.CurrencyType currency_,
        uint256 pointsUnitPriceInCurrencyE6_,
        address initialOwner,
        address gateway_
    ) ERC1155(uri_) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert BM_ZeroAddress();
        if (gateway_ == address(0) || gateway_.code.length == 0) revert UC_GlobalMisconfigured();

        deployer = msg.sender;
        gateway = gateway_;
        debugGateway = gateway_;

        currency = currency_;
        pointsUnitPriceInCurrencyE6 = pointsUnitPriceInCurrencyE6_;

        threshold = 1;
        isAdmin[initialOwner] = true;
        adminList.push(initialOwner);
    }

    // ==========================================================
    // Tiers
    // ==========================================================
    function setDefaultAttr(uint256 attr) external onlyAdmin {
        emit DefaultAttrUpdated(defaultAttrWhenNoTiers);
        defaultAttrWhenNoTiers = attr;
    }

    function appendTier(uint256 minUsdc6, uint256 attr) external onlyAdmin {
        if (minUsdc6 == 0) revert UC_TierMinZero();
        if (tiers.length > 0) {
            Tier memory last = tiers[tiers.length - 1];
            // strict decreasing
            if (minUsdc6 >= last.minUsdc6) revert UC_TiersNotDecreasing();
        }
        uint256 idx = tiers.length;
        tiers.push(Tier(minUsdc6, attr));
        emit TierAppended(idx, minUsdc6, attr);
    }

    function setTiers(Tier[] calldata newTiers) external onlyAdmin {
        if (newTiers.length == 0) revert UC_TierLenMismatch();

        uint256 prev = type(uint256).max;
        for (uint256 i = 0; i < newTiers.length; i++) {
            uint256 minPointsDelta6 = newTiers[i].minUsdc6;
            if (minPointsDelta6 == 0) revert UC_TierMinZero();
            if (minPointsDelta6 >= prev) revert UC_TiersNotDecreasing();
            prev = minPointsDelta6;
        }

        delete tiers;
        for (uint256 i = 0; i < newTiers.length; i++) tiers.push(newTiers[i]);
        emit TiersUpdated(newTiers.length);
    }

    function getTiersCount() external view returns (uint256) { return tiers.length; }
    function getTierAt(uint256 idx) external view returns (Tier memory) { return tiers[idx]; }

    // ==========================================================
    // Pricing
    // ==========================================================
    function setPointsUnitPrice(uint256 priceInCurrencyE6) external onlyAdmin {
        if (priceInCurrencyE6 == 0) revert UC_PriceZero();
        pointsUnitPriceInCurrencyE6 = priceInCurrencyE6;
        emit PointsUnitPriceUpdated(priceInCurrencyE6);
    }

    function setExpirySeconds(uint256 secs) external onlyAdmin {
        emit ExpirySecondsUpdated(expirySeconds, secs);
        expirySeconds = secs;
    }

    // ==========================================================
    // Faucet config
    // ==========================================================
    function setFaucetConfig(
        uint256 id,
        uint64 validUntil,
        uint64 perClaimMax,
        uint128 maxPerUser,
        uint128 maxGlobal,
        bool enabled,
        BeamioCurrency.CurrencyType cur,
        uint128 priceInCurrency6
    ) external onlyAuthorizedGateway {
        if (faucetConfigFrozen[id]) revert UC_FaucetConfigFrozen();

        FaucetConfig storage cfg = faucetConfig[id];
        cfg.validUntil = validUntil;
        cfg.perClaimMax = perClaimMax;
        cfg.maxPerUser = maxPerUser;
        cfg.maxGlobal = maxGlobal;
        cfg.enabled = enabled;
        cfg.currency = uint8(cur);
        cfg.decimals = POINTS_DECIMALS;
        cfg.priceInCurrency6 = priceInCurrency6;

        _validateFaucetConfig(cfg);
        faucetConfigFrozen[id] = true;

        emit FaucetConfigUpdated(id, cfg);
    }

    function _validateFaucetConfig(FaucetConfig memory cfg) private pure {
        if (!cfg.enabled && cfg.validUntil == 0) revert UC_FaucetConfigInvalid();
        if (cfg.decimals != POINTS_DECIMALS) revert UC_FaucetConfigInvalid();
        if (cfg.perClaimMax == 0) revert UC_FaucetConfigInvalid();
        if (cfg.maxPerUser == 0 || cfg.maxGlobal == 0) revert UC_FaucetConfigInvalid();
    }

    // ==========================================================
    // Faucet (free)
    // ==========================================================
    function faucetByGateway(address userEOA, uint256 id, uint256 amount)
        external
        onlyAuthorizedGateway
        nonReentrant
    {
        if (userEOA == address(0)) revert BM_ZeroAddress();
        if (amount == 0) revert UC_AmountZero();

        FaucetConfig storage cfg = faucetConfig[id];
        if (!cfg.enabled) revert UC_FaucetNotEnabled();
        if (block.timestamp > cfg.validUntil) revert UC_FaucetExpired();
        if (amount > cfg.perClaimMax) revert UC_FaucetAmountTooLarge();
        if (!IBeamioFactoryOracle(factoryGateway()).isTokenIdIssued(address(this), id)) revert UC_FaucetIdNotIssued();
        if (cfg.priceInCurrency6 != 0) revert UC_FaucetDisabledBecausePriced();

        if (faucetClaimed[id][userEOA] + amount > cfg.maxPerUser) revert UC_FaucetMaxExceeded();
        if (faucetGlobalMinted[id] + amount > cfg.maxGlobal) revert UC_FaucetGlobalMaxExceeded();

        faucetClaimed[id][userEOA] += amount;
        faucetGlobalMinted[id] += amount;

        address acct = _toAccount(userEOA);

        _syncActiveToBestValid(acct);
        bool hasValidCard = (activeMembershipId[acct] != 0);

        _mint(acct, id, amount, "");

        uint256 pointsDelta6 = (id == POINTS_ID) ? amount : 0;
        if (!hasValidCard) _issueCardByPointsDelta_AssumingNoValidCard(acct, pointsDelta6);

        emit FaucetClaimed(id, userEOA, acct, amount, faucetClaimed[id][userEOA]);
    }

    // ==========================================================
    // Faucet (paid) via ERC-3009
    // ==========================================================
    function faucetPurchaseWith3009AuthorizationByGateway(
        address userEOA,
        uint256 id,
        uint256 amount6,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external onlyAuthorizedGateway nonReentrant {
        if (userEOA == address(0)) revert BM_ZeroAddress();
        if (amount6 == 0) revert UC_AmountZero();

        FaucetConfig storage cfg = faucetConfig[id];
        if (!cfg.enabled) revert UC_FaucetNotEnabled();
        if (block.timestamp > cfg.validUntil) revert UC_FaucetExpired();
        if (amount6 > cfg.perClaimMax) revert UC_FaucetAmountTooLarge();
        if (!IBeamioFactoryOracle(factoryGateway()).isTokenIdIssued(address(this), id)) revert UC_FaucetIdNotIssued();
        if (cfg.priceInCurrency6 == 0) revert UC_PurchaseDisabledBecauseFree();

        if (faucetClaimed[id][userEOA] + amount6 > cfg.maxPerUser) revert UC_FaucetMaxExceeded();
        if (faucetGlobalMinted[id] + amount6 > cfg.maxGlobal) revert UC_FaucetGlobalMaxExceeded();

        uint256 usdcAmount6 = IBeamioFactoryOracle(factoryGateway()).quoteCurrencyAmountInUSDC6(
            cfg.currency,
            (uint256(cfg.priceInCurrency6) * amount6) / POINTS_ONE
        );

        _executeUSDC3009Transfer(userEOA, usdcAmount6, validAfter, validBefore, nonce, signature);

        faucetClaimed[id][userEOA] += amount6;
        faucetGlobalMinted[id] += amount6;

        address acct = _toAccount(userEOA);
        _mint(acct, id, amount6, "");
    }

    // ==========================================================
    // Redeem suite (owner issues; gateway consumes)
    // ==========================================================

    /// @notice card owner (or gateway) creates a one-time redeem
    function createRedeem(
        bytes32 hash,
        uint256 points6,
        uint256 attr,
        uint64 validAfter,
        uint64 validBefore,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) external nonReentrant {
        _requireOwnerOrGateway();

        address module = _redeemModule();
        (bool ok, bytes memory data) = module.delegatecall(
            abi.encodeWithSelector(
                IBeamioRedeemModuleVNext.createRedeem.selector,
                hash,
                points6,
                attr,
                validAfter,
                validBefore,
                tokenIds,
                amounts
            )
        );
        if (!ok) revert UC_RedeemDelegateFailed(data);

        emit RedeemCreated(hash, points6, attr);
    }

    /// @notice card owner (or gateway) cancels redeem by code string
    function cancelRedeem(string calldata code) external nonReentrant {
        _requireOwnerOrGateway();

        address module = _redeemModule();
        (bool ok, bytes memory data) = module.delegatecall(
            abi.encodeWithSelector(IBeamioRedeemModuleVNext.cancelRedeem.selector, code)
        );
        if (!ok) revert UC_RedeemDelegateFailed(data);

        emit RedeemCancelled(keccak256(bytes(code)));
    }

    /// @notice card owner (or gateway) creates a redeem pool (repeatable password; each user once)
    function createRedeemPool(
        bytes32 poolHash,
        uint64 validAfter,
        uint64 validBefore,
        uint256[][] calldata tokenIdsList,
        uint256[][] calldata amountsList,
        uint32[] calldata counts
    ) external nonReentrant {
        _requireOwnerOrGateway();

        address module = _redeemModule();
        (bool ok, bytes memory data) = module.delegatecall(
            abi.encodeWithSelector(
                IBeamioRedeemModuleVNext.createRedeemPool.selector,
                poolHash,
                validAfter,
                validBefore,
                tokenIdsList,
                amountsList,
                counts
            )
        );
        if (!ok) revert UC_RedeemDelegateFailed(data);
    }

    /// @notice card owner (or gateway) terminates pool
    function terminateRedeemPool(bytes32 poolHash) external nonReentrant {
        _requireOwnerOrGateway();

        address module = _redeemModule();
        (bool ok, bytes memory data) = module.delegatecall(
            abi.encodeWithSelector(IBeamioRedeemModuleVNext.terminateRedeemPool.selector, poolHash)
        );
        if (!ok) revert UC_RedeemDelegateFailed(data);
    }

    /// @notice gateway consumes one-time redeem and mints to user's AA account
    function redeemByGateway(string calldata code, address userEOA)
        external
        onlyAuthorizedGateway
        nonReentrant
    {
        if (userEOA == address(0)) revert BM_ZeroAddress();

        address module = _redeemModule();
        (bool ok, bytes memory data) = module.delegatecall(
            abi.encodeWithSelector(IBeamioRedeemModuleVNext.consumeRedeem.selector, code, userEOA)
        );
        if (!ok) revert UC_RedeemDelegateFailed(data);

        (uint256 points6, uint256 attr, uint256[] memory tokenIds, uint256[] memory amounts) =
            abi.decode(data, (uint256, uint256, uint256[], uint256[]));
        attr; // 未使用的变量
        if (tokenIds.length != amounts.length) revert UC_RedeemDelegateFailed(data);

        address acct = _toAccount(userEOA);

        _syncActiveToBestValid(acct);
        bool hasValidCard = (activeMembershipId[acct] != 0);

        if (!hasValidCard && tiers.length > 0) {
            uint256 minReqPoints6 = tiers[tiers.length - 1].minUsdc6;
            if (points6 < minReqPoints6) revert UC_BelowMinThreshold();
        }

        if (points6 > 0) _mint(acct, POINTS_ID, points6, "");

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 amt = amounts[i];
            if (amt == 0) revert UC_AmountZero();
            _mint(acct, tokenIds[i], amt, "");
        }

        if (!hasValidCard) _issueCardByPointsDelta_AssumingNoValidCard(acct, points6);
    }

    /// @notice gateway consumes pool redeem and mints to user's AA account (bundle only)
    function redeemPoolByGateway(string calldata code, address userEOA)
        external
        onlyAuthorizedGateway
        nonReentrant
    {
        if (userEOA == address(0)) revert BM_ZeroAddress();

        address module = _redeemModule();
        (bool ok, bytes memory data) = module.delegatecall(
            abi.encodeWithSelector(IBeamioRedeemModuleVNext.consumeRedeemPool.selector, code, userEOA)
        );
        if (!ok) revert UC_RedeemDelegateFailed(data);

        (uint256[] memory tokenIds, uint256[] memory amounts) = abi.decode(data, (uint256[], uint256[]));
        if (tokenIds.length != amounts.length) revert UC_RedeemDelegateFailed(data);

        address acct = _toAccount(userEOA);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 amt = amounts[i];
            if (amt == 0) revert UC_AmountZero();
            _mint(acct, tokenIds[i], amt, "");
        }
    }

    function _redeemModule() internal view returns (address module) {
        address gw = factoryGateway();
        if (gw == address(0) || gw.code.length == 0) revert UC_GlobalMisconfigured();

        module = IBeamioUserCardFactoryPaymasterV07(gw).defaultRedeemModule();
        if (module == address(0)) revert UC_RedeemModuleZero();
    }

    function _requireOwnerOrGateway() internal view {
        address gw = debugGateway == address(0) ? gateway : debugGateway;
        if (msg.sender != owner() && msg.sender != gw) revert BM_NotAuthorized();
    }

    // ==========================================================
    // Open authorization transfer (points only)
    // ==========================================================
    function _openAuthKey(address fromEOA, uint256 id, bytes32 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(fromEOA, id, nonce));
    }

    function transferWithOpenAuthorizationByGateway(
        address fromEOA,
        address toEOA,
        uint256 id,
        uint256 amount,
        uint256 maxAmount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata sig
    ) external onlyAuthorizedGateway nonReentrant {
        OpenAuthParams memory p = OpenAuthParams({
            fromEOA: fromEOA,
            toEOA: toEOA,
            id: id,
            amount: amount,
            maxAmount: maxAmount,
            validAfter: validAfter,
            validBefore: validBefore,
            nonce: nonce
        });

        _transferWithOpenAuth(p, sig);
    }

    function _transferWithOpenAuth(OpenAuthParams memory p, bytes calldata sig) internal {
        if (p.fromEOA == address(0) || p.toEOA == address(0)) revert BM_ZeroAddress();
        if (p.maxAmount == 0) revert UC_AmountZero();
        if (p.amount == 0 || p.amount > p.maxAmount) revert UC_AmountZero();
        if (p.id != POINTS_ID) revert UC_InvalidTokenId(p.id, POINTS_ID);

        bytes32 h = MessageHashUtils.toEthSignedMessageHash(
            keccak256(
                abi.encode(
                    "OpenTransfer",
                    factoryGateway(),
                    address(this),
                    block.chainid,
                    p.fromEOA,
                    p.id,
                    p.maxAmount,
                    p.validAfter,
                    p.validBefore,
                    p.nonce
                )
            )
        );

        address recovered = ECDSA.recover(h, sig);
        if (recovered != p.fromEOA) revert UC_InvalidSignature(recovered, p.fromEOA);

        uint256 nowTs = block.timestamp;
        if (nowTs < p.validAfter || nowTs > p.validBefore) {
            revert UC_InvalidTimeWindow(nowTs, p.validAfter, p.validBefore);
        }

        bytes32 k = _openAuthKey(p.fromEOA, p.id, p.nonce);
        if (openAuthUsed[k]) revert UC_OpenAuthAlreadyUsed(k);
        openAuthUsed[k] = true;

        address fromAccount = _resolveAccount(p.fromEOA);
        address toAccount = _resolveAccount(p.toEOA);

        uint256 bal = balanceOf(fromAccount, p.id);
        if (bal < p.amount) revert UC_InsufficientBalance(fromAccount, p.id, bal, p.amount);

        _safeTransferFrom(fromAccount, toAccount, p.id, p.amount, "");

        emit OpenTransferAuthorized(p.fromEOA, fromAccount, p.id, p.amount, p.maxAmount, p.nonce, toAccount);
    }

    // ==========================================================
    // Buy points with ERC-3009
    // ==========================================================
    function buyPointsWith3009Authorization(
        address fromEOA,
        uint256 usdcAmount6,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature,
        uint256 minPointsOut6
    ) external nonReentrant returns (uint256 pointsOut6) {
        if (fromEOA == address(0)) revert BM_ZeroAddress();
        if (usdcAmount6 == 0) revert UC_AmountZero();

        address acct = _toAccount(fromEOA);

        uint256 unitPriceUsdc6 = IBeamioFactoryOracle(factoryGateway()).quoteUnitPointInUSDC6(address(this));
        if (unitPriceUsdc6 == 0) revert UC_PriceZero();

        pointsOut6 = (usdcAmount6 * POINTS_ONE) / unitPriceUsdc6;
        if (pointsOut6 == 0) revert UC_PointsZero();
        if (pointsOut6 < minPointsOut6) revert UC_Slippage();

        _syncActiveToBestValid(acct);
        bool hasValidCard = _syncAndHasValidCard(acct);

        if (!hasValidCard && tiers.length > 0) {
            uint256 minReqPoints6 = tiers[tiers.length - 1].minUsdc6;
            if (pointsOut6 < minReqPoints6) revert UC_BelowMinThreshold();
        }

        _executeUSDC3009Transfer(fromEOA, usdcAmount6, validAfter, validBefore, nonce, signature);
        _mint(acct, POINTS_ID, pointsOut6, "");

        if (!hasValidCard) _issueCardByPointsDelta_AssumingNoValidCard(acct, pointsOut6);

        emit PointsPurchasedWithUSDC(
            fromEOA,
            acct,
            IBeamioFactoryOracle(factoryGateway()).USDC(),
            usdcAmount6,
            pointsOut6,
            unitPriceUsdc6,
            nonce
        );

        return pointsOut6;
    }

    function _executeUSDC3009Transfer(
        address fromEOA,
        uint256 val,
        uint256 afterTs,
        uint256 beforeTs,
        bytes32 nonce,
        bytes calldata sig
    ) internal {
        address usdc = IBeamioFactoryOracle(factoryGateway()).USDC();
        if (usdc == address(0)) revert BM_ZeroAddress();

        address merchant = owner();
        if (merchant == address(0)) revert BM_ZeroAddress();

        IERC3009BytesSig(usdc).transferWithAuthorization(fromEOA, merchant, val, afterTs, beforeTs, nonce, sig);
    }

    // ==========================================================
    // Admin minting
    // ==========================================================
    function mintPointsByAdmin(address user, uint256 points6) external onlyAdmin nonReentrant {
        if (user == address(0)) revert BM_ZeroAddress();
        if (points6 == 0) revert UC_AmountZero();

        address acct = _toAccount(user);
        _mint(acct, POINTS_ID, points6, "");

        _maybeIssueOnlyIfNoneOrExpiredByPointsDelta(acct, points6);
        emit AdminPointsMinted(acct, points6);
    }

    function _addAdmin(address newAdmin, uint256 newThreshold) internal {
        if (newAdmin == address(0)) revert BM_ZeroAddress();
        if (!isAdmin[newAdmin]) {
            isAdmin[newAdmin] = true;
            adminList.push(newAdmin);
        }
        if (newThreshold > adminList.length) revert UC_InvalidProposal();
        threshold = newThreshold;
    }

    function addAdmin(address newAdmin, uint256 newThreshold) public onlyAdmin {
        _addAdmin(newAdmin, newThreshold);
    }

    // bytes4(keccak256("setTransferWhitelistEnabled(bool)"))
    bytes4 private constant SEL_SET_WL_ENABLED = bytes4(keccak256("setTransferWhitelistEnabled(bool)"));

    function _execute(uint256 id) internal {
        Proposal storage p = proposals[id];
        if (p.executed) revert UC_InvalidProposal();
        p.executed = true;

        if (p.selector == bytes4(keccak256("addAdmin(address,uint256)"))) {
            _addAdmin(p.target, p.v1);
        } else if (p.selector == bytes4(keccak256("mintPoints(address,uint256)"))) {
            _mint(p.target, POINTS_ID, p.v1, "");
        } else if (p.selector == bytes4(keccak256("mintMemberCard(address,uint256)"))) {
            _mintMemberCardInternal(p.target, p.v2);
        } else if (p.selector == bytes4(keccak256("setTransferWhitelist(address,bool)"))) {
            _setTransferWhitelist(p.target, p.v1 == 1);
        } else if (p.selector == SEL_SET_WL_ENABLED) {
            _setTransferWhitelistEnabled(p.v1 == 1);
        }

        emit ProposalExecuted(id);
    }

    function createProposal(bytes4 selector, address target, uint256 v1, uint256 v2, uint256 v3)
        external
        onlyAuthorizedGateway
        returns (uint256)
    {
        uint256 id = proposalCount++;
        proposals[id] = Proposal(target, v1, v2, v3, selector, 0, false);
        emit ProposalCreated(id, selector, msg.sender);

        if (isAdmin[msg.sender]) _approve(id, msg.sender);
        return id;
    }

    function approveProposalByGateway(uint256 id, address adminSigner) external {
        if (msg.sender != factoryGateway()) revert UC_UnauthorizedGateway();
        if (!isAdmin[adminSigner]) revert UC_NotAdmin();
        _approve(id, adminSigner);
    }

    function approveProposal(uint256 id) external onlyAdmin {
        _approve(id, msg.sender);
    }

    function _approve(uint256 id, address admin) internal {
        Proposal storage p = proposals[id];
        if (p.executed) revert UC_InvalidProposal();
        if (isApproved[id][admin]) revert UC_InvalidProposal();

        isApproved[id][admin] = true;
        p.approvals++;
        emit ProposalApproved(id, admin);

        if (p.approvals >= threshold) _execute(id);
    }

    function _setTransferWhitelist(address target, bool allowed) internal {
        transferWhitelist[target] = allowed;
    }

    function setTransferWhitelist(address target, bool allowed) external onlyAdmin {
        _setTransferWhitelist(target, allowed);
    }

    function mintMemberCardByAdmin(address user, uint256 tierIndex) external onlyAdmin nonReentrant {
        _mintMemberCardInternal(user, tierIndex);
    }

    function _mintMemberCardInternal(address user, uint256 tierIndex) internal {
        if (user == address(0)) revert BM_ZeroAddress();
        if (tiers.length == 0) revert UC_MustGrow();
        if (tierIndex >= tiers.length) revert UC_MustGrow();

        address acct = _toAccount(user);

        uint256 currentActiveId = activeMembershipId[acct];
        if (currentActiveId != 0 && !_isExpired(currentActiveId)) revert UC_AlreadyHasValidCard();

        uint256 newId = _currentIndex++;
        Tier memory tier = tiers[tierIndex];

        _mint(acct, newId, 1, "");

        expiresAt[newId] = (expirySeconds == 0) ? 0 : (block.timestamp + expirySeconds);
        attributes[newId] = tier.attr;
        tokenTierIndexOrMax[newId] = tierIndex;
        _userOwnedNfts[acct].push(newId);
        activeMembershipId[acct] = newId;
        activeTierIndexOrMax[acct] = tierIndex;

        emit AdminCardMinted(acct, newId, tier.attr, expiresAt[newId]);
    }

    // ==========================================================
    // ERC1155 update hook
    // ==========================================================
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        bool isRealTransfer = (from != address(0) && to != address(0));

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];

            if (id >= NFT_START_ID && id < ISSUED_NFT_START_ID) {
                if (!(from == address(0) || to == address(0))) revert UC_SBTNonTransferable();
                if (to == address(0) && from != address(0)) _removeNft(from, id);
                continue;
            }

            if (id == POINTS_ID && isRealTransfer) {
                if (transferWhitelistEnabled) {
                    if (!transferWhitelist[address(0)]) {
                        if (!transferWhitelist[to]) revert UC_PointsToNotWhitelisted();
                    }
                }

                address f = IBeamioFactoryOracle(factoryGateway()).aaFactory();
                if (f == address(0)) revert UC_GlobalMisconfigured();

                if (!IBeamioAccountFactoryV07(f).isBeamioAccount(to)) revert UC_NoBeamioAccount();
                if (to.code.length == 0) revert UC_NoBeamioAccount();
            }
        }

        super._update(from, to, ids, values);
    }

    function _removeNft(address user, uint256 id) internal {
        uint256[] storage list = _userOwnedNfts[user];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == id) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
        if (activeMembershipId[user] == id) {
            activeMembershipId[user] = 0;
            activeTierIndexOrMax[user] = type(uint256).max;
        }
    }

    // ==========================================================
    // Views
    // ==========================================================
    function getOwnership(address user) public view returns (uint256 pt, NFTDetail[] memory nfts) {
        uint256[] storage nftIds = _userOwnedNfts[user];
        nfts = new NFTDetail[](nftIds.length);

        for (uint256 i = 0; i < nftIds.length; i++) {
            uint256 id = nftIds[i];
            uint256 exp = expiresAt[id];
            bool expired = (exp != 0 && block.timestamp > exp);
            nfts[i] = NFTDetail(id, attributes[id], tokenTierIndexOrMax[id], exp, expired);
        }

        return (balanceOf(user, POINTS_ID), nfts);
    }

    function getOwnershipByEOA(address userEOA) external view returns (uint256 pt, NFTDetail[] memory nfts) {
        address acct = _resolveAccount(userEOA);
        return getOwnership(acct);
    }

    // ==========================================================
    // Membership helpers
    // ==========================================================
    function _tierMinPoints6(uint256 i) internal view returns (uint256) { return tiers[i].minUsdc6; }

    function _isExpired(uint256 tokenId) internal view returns (bool) {
        uint256 exp = expiresAt[tokenId];
        return (exp != 0 && block.timestamp > exp);
    }

    function _hasValidCard(address acct) internal view returns (bool) {
        uint256 id = activeMembershipId[acct];
        return (id != 0 && balanceOf(acct, id) > 0 && !_isExpired(id));
    }

    function _syncAndHasValidCard(address acct) internal returns (bool) {
        _syncActiveToBestValid(acct);
        return _hasValidCard(acct);
    }

    function _syncActiveToBestValid(address user) internal {
        uint256 cur = activeMembershipId[user];
        if (cur != 0) {
            if (balanceOf(user, cur) > 0 && !_isExpired(cur)) {
                activeTierIndexOrMax[user] = tokenTierIndexOrMax[cur];
                return;
            }
        }

        uint256[] storage nftIds = _userOwnedNfts[user];
        if (nftIds.length == 0) {
            activeMembershipId[user] = 0;
            activeTierIndexOrMax[user] = type(uint256).max;
            return;
        }

        uint256 bestId = 0;
        uint256 bestTierIndex = type(uint256).max;

        for (uint256 i = 0; i < nftIds.length; i++) {
            uint256 id = nftIds[i];
            if (balanceOf(user, id) == 0) continue;
            if (_isExpired(id)) continue;

            uint256 tierIdx = tokenTierIndexOrMax[id];
            if (tierIdx < bestTierIndex) {
                bestId = id;
                bestTierIndex = tierIdx;
            }
        }

        activeMembershipId[user] = bestId;
        activeTierIndexOrMax[user] = bestTierIndex;
    }

    function _maybeIssueOnlyIfNoneOrExpiredByPointsDelta(address acctOrEOA, uint256 pointsDelta6) internal {
        address acct = _toAccount(acctOrEOA);
        _syncActiveToBestValid(acct);

        if (activeMembershipId[acct] != 0) return;

        if (tiers.length == 0) {
            uint256 expiry = (expirySeconds == 0) ? 0 : (block.timestamp + expirySeconds);
            uint256 newId = _currentIndex++;

            _mint(acct, newId, 1, "");

            expiresAt[newId] = expiry;
            attributes[newId] = defaultAttrWhenNoTiers;
            tokenTierIndexOrMax[newId] = type(uint256).max;
            _userOwnedNfts[acct].push(newId);

            emit MemberNFTIssued(acct, newId, type(uint256).max, 0, expiry);

            activeMembershipId[acct] = newId;
            activeTierIndexOrMax[acct] = type(uint256).max;
            return;
        }

        uint256 tierIdx = type(uint256).max;
        uint256 attr = 0;

        for (uint256 i = 0; i < tiers.length; i++) {
            if (pointsDelta6 >= _tierMinPoints6(i)) {
                tierIdx = i;
                attr = tiers[i].attr;
                break;
            }
        }
        if (tierIdx == type(uint256).max) return;

        uint256 expiry2 = (expirySeconds == 0) ? 0 : (block.timestamp + expirySeconds);
        uint256 newId2 = _currentIndex++;

        _mint(acct, newId2, 1, "");

        expiresAt[newId2] = expiry2;
        attributes[newId2] = attr;
        tokenTierIndexOrMax[newId2] = tierIdx;
        _userOwnedNfts[acct].push(newId2);

        emit MemberNFTIssued(acct, newId2, tierIdx, tiers[tierIdx].minUsdc6, expiry2);

        activeMembershipId[acct] = newId2;
        activeTierIndexOrMax[acct] = tierIdx;
    }

    function _issueCardByPointsDelta_AssumingNoValidCard(address acct, uint256 pointsDelta6) internal {
        if (activeMembershipId[acct] != 0) revert UC_AlreadyHasValidCard();

        if (tiers.length == 0) {
            uint256 expiry = (expirySeconds == 0) ? 0 : (block.timestamp + expirySeconds);
            uint256 newId = _currentIndex++;

            _mint(acct, newId, 1, "");

            expiresAt[newId] = expiry;
            attributes[newId] = defaultAttrWhenNoTiers;
            tokenTierIndexOrMax[newId] = type(uint256).max;
            _userOwnedNfts[acct].push(newId);

            emit MemberNFTIssued(acct, newId, type(uint256).max, 0, expiry);

            activeMembershipId[acct] = newId;
            activeTierIndexOrMax[acct] = type(uint256).max;
            return;
        }

        uint256 tierIdx = type(uint256).max;
        uint256 attr = 0;

        for (uint256 i = 0; i < tiers.length; i++) {
            if (pointsDelta6 >= tiers[i].minUsdc6) {
                tierIdx = i;
                attr = tiers[i].attr;
                break;
            }
        }
        if (tierIdx == type(uint256).max) return;

        uint256 expiry2 = (expirySeconds == 0) ? 0 : (block.timestamp + expirySeconds);
        uint256 newId2 = _currentIndex++;

        _mint(acct, newId2, 1, "");

        expiresAt[newId2] = expiry2;
        attributes[newId2] = attr;
        tokenTierIndexOrMax[newId2] = tierIdx;
        _userOwnedNfts[acct].push(newId2);

        emit MemberNFTIssued(acct, newId2, tierIdx, tiers[tierIdx].minUsdc6, expiry2);

        activeMembershipId[acct] = newId2;
        activeTierIndexOrMax[acct] = tierIdx;
    }

    // ==========================================================
    // AA account resolve
    // ==========================================================
    function _toAccount(address maybeEoaOrAcct) internal view returns (address acct) {
        address f = IBeamioFactoryOracle(factoryGateway()).aaFactory();
        if (f == address(0)) revert UC_GlobalMisconfigured();

        if (IBeamioAccountFactoryV07(f).isBeamioAccount(maybeEoaOrAcct)) {
            if (maybeEoaOrAcct.code.length == 0) revert UC_NoBeamioAccount();
            return maybeEoaOrAcct;
        }
        return _resolveAccount(maybeEoaOrAcct);
    }

    function _resolveAccount(address eoa) internal view returns (address) {
        address aaFactory = IBeamioGatewayAAFactoryGetter(factoryGateway())._aaFactory();
        if (aaFactory == address(0)) revert UC_GlobalMisconfigured();

        address acct = IBeamioAccountFactoryV07(aaFactory).beamioAccountOf(eoa);
        if (acct == address(0) || acct.code.length == 0) revert UC_ResolveAccountFailed(eoa, aaFactory, acct);
        return acct;
    }
}
