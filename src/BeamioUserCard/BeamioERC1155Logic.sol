// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BeamioCurrency.sol";
import "./Errors.sol";

import "../contracts/token/ERC1155/ERC1155.sol";
import "../contracts/utils/cryptography/ECDSA.sol";

/* =========================
   Interfaces at file scope
   ========================= */

interface IERC3009BytesSig {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
}

interface IBeamioFactoryOracle {
    function USDC() external view returns (address);
    function quoteUnitPointInUSDC6(address card) external view returns (uint256);
    function quoteCurrencyAmountInUSDC6(uint8 currency, uint256 amount6) external view returns (uint256);
    function isTokenIdIssued(address card, uint256 id) external view returns (bool);
    function aaFactory() external view returns (address);
}

interface IRedeemModule {
    function createRedeem(bytes32 hash, uint256 points6, uint256 attr, uint256 tokenId, uint256 tokenAmt) external;
    function cancelRedeem(string calldata code) external;
    function consumeRedeem(string calldata code, address to)
        external
        returns (uint256 points6, uint256 attr, uint256 tokenId, uint256 tokenAmt);
}

interface IBeamioAccountFactoryV07 {
    function isBeamioAccount(address a) external view returns (bool);
    function beamioAccountOf(address creator) external view returns (address);
}

/**
 * @title BeamioERC1155Logic
 * @notice 通用的 ERC1155 执行逻辑库，适用于所有 Beamio ERC1155 合约
 * @dev
 *   - 本文件已移除所有本地 error 声明，统一使用 Errors.sol
 *   - 只保留逻辑与 Layout 存储结构
 */
library BeamioERC1155Logic {
    using BeamioCurrency for *;
    using ECDSA for bytes32;

    // ===== Constants =====
    uint256 public constant POINTS_ID = 0;
    uint8 public constant POINTS_DECIMALS = 6;
    uint256 private constant POINTS_ONE = 1e6;

    // membership SBT ids range: [100, 100000000000)
    uint256 public constant NFT_START_ID = 100;
    uint256 public constant ISSUED_NFT_START_ID = 100000000000;

    // ===== Tier Struct =====
    struct Tier {
        uint256 minUsdc6;
        uint256 attr;
    }

    struct Faucet {
        uint64 validUntil;
        uint64 perClaimMax;
        uint128 maxPerUser;
        uint128 maxGlobal;
        bool enabled;
        uint8 currency;
        uint8 decimals; // MUST be 6
        uint128 priceInCurrency6; // 0 => free faucet; >0 => priced mode
    }

    struct NFTDetail {
        uint256 tokenId;
        uint256 attribute;
        uint256 tierIndexOrMax;
        uint256 expiry;
        bool isExpired;
    }

    // ===== Core Storage Layout (must match BeamioUserCard if you plan to share storage) =====
    struct Layout {
        // Pricing
        BeamioCurrency.CurrencyType currency;
        uint256 pointsUnitPriceInCurrencyE6;

        // Expiry & Redeem
        uint256 expirySeconds;
        address redeemModule;

        // Governance
        uint256 threshold;
        mapping(address => bool) isAdmin;
        address[] adminList;

        mapping(uint256 => mapping(address => bool)) isApproved;
        uint256 proposalCount;

        // Whitelist
        mapping(address => bool) transferWhitelist;

        // Membership state
        mapping(uint256 => uint256) expiresAt;
        mapping(uint256 => uint256) attributes;
        mapping(uint256 => uint256) tokenTierIndexOrMax;
        mapping(address => uint256[]) userOwnedNfts;

        mapping(address => uint256) activeMembershipId;
        mapping(address => uint256) activeTierIndexOrMax;

        // Tiers
        Tier[] tiers;
        uint256 defaultAttrWhenNoTiers;

        // Faucet
        mapping(uint256 => Faucet) faucetConfig;
        mapping(uint256 => mapping(address => uint256)) faucetClaimed;
        mapping(uint256 => uint256) faucetGlobalMinted;
        mapping(uint256 => bool) faucetConfigFrozen;

        // Open auth
        mapping(bytes32 => uint256) openAuthSpent;

        // Index tracking (IMPORTANT: initialize to NFT_START_ID in your initializer/constructor)
        uint256 currentIndex;
    }

    // ===== Events (mirrored from BeamioUserCard) =====
    event ExpirySecondsUpdated(uint256 oldSecs, uint256 newSecs);
    event RedeemModuleUpdated(address indexed oldModule, address indexed newModule);
    event PointsUnitPriceUpdated(uint256 priceInCurrencyE6);

    event MemberNFTIssued(address indexed user, uint256 indexed tokenId, uint256 tierIndexOrMax, uint256 minUsdc6, uint256 expiry);
    event MemberNFTUpgraded(address indexed user, uint256 indexed oldActiveTokenId, uint256 indexed newTokenId, uint256 oldTierIndexOrMax, uint256 newTierIndex, uint256 newExpiry);

    event TiersUpdated(uint256 count);
    event TierAppended(uint256 index, uint256 minUsdc6, uint256 attr);
    event DefaultAttrUpdated(uint256 attr);

    event AdminCardMinted(address indexed beneficiaryAccount, uint256 indexed tokenId, uint256 attr, uint256 expiry);
    event AdminPointsMinted(address indexed beneficiaryAccount, uint256 points6);

    event PointsPurchasedWithUSDC(
        address indexed payerEOA,
        address indexed beneficiaryAccount,
        address indexed usdc,
        uint256 usdcIn6,
        uint256 pointsMinted6,
        uint256 unitPointPriceUsdc6,
        bytes32 nonce
    );

    event FaucetConfigUpdated(uint256 indexed id, Faucet cfg);
    event FaucetClaimed(uint256 indexed id, address indexed userEOA, address indexed acct, uint256 amount, uint256 claimedAfter);

    event OpenTransferAuthorized(
        address indexed fromEOA,
        address indexed fromAccount,
        uint256 indexed id,
        uint256 amount,
        uint256 maxAmount,
        bytes32 nonce,
        address toAccount
    );

    // ==========================================================
    // Internal Helpers
    // ==========================================================

    function _isExpired(uint256 tokenId, Layout storage layout) internal view returns (bool) {
        uint256 exp = layout.expiresAt[tokenId];
        return (exp != 0 && block.timestamp > exp);
    }

    /// @dev 关键修正：必须检查 balanceOf(user,id)>0，否则 burn/转移后仍可能被当成有效卡
    function _syncActiveToBestValid(address user, address erc1155Addr, Layout storage layout) internal {
        ERC1155 token = ERC1155(erc1155Addr);

        // keep current active if still valid
        uint256 cur = layout.activeMembershipId[user];
        if (cur != 0) {
            if (token.balanceOf(user, cur) > 0 && !_isExpired(cur, layout)) {
                layout.activeTierIndexOrMax[user] = layout.tokenTierIndexOrMax[cur];
                return;
            }
        }

        uint256[] storage nftIds = layout.userOwnedNfts[user];
        if (nftIds.length == 0) {
            layout.activeMembershipId[user] = 0;
            layout.activeTierIndexOrMax[user] = type(uint256).max;
            return;
        }

        uint256 bestId = 0;
        uint256 bestTierIndex = type(uint256).max;

        for (uint256 i = 0; i < nftIds.length; i++) {
            uint256 id = nftIds[i];
            if (token.balanceOf(user, id) == 0) continue;
            if (_isExpired(id, layout)) continue;

            uint256 tierIdx = layout.tokenTierIndexOrMax[id];
            if (tierIdx < bestTierIndex) {
                bestId = id;
                bestTierIndex = tierIdx;
            }
        }

        layout.activeMembershipId[user] = bestId;
        layout.activeTierIndexOrMax[user] = bestTierIndex;
    }

    /// @dev tiers 语义：从高门槛到低门槛（满足即 break）
    function _tierFromPointsValue(uint256 points6, Layout storage layout)
        internal
        view
        returns (bool ok, uint256 tierIndex, uint256 attr)
    {
        if (layout.tiers.length == 0) return (true, type(uint256).max, layout.defaultAttrWhenNoTiers);

        for (uint256 i = 0; i < layout.tiers.length; i++) {
            if (points6 >= layout.tiers[i].minUsdc6) {
                return (true, i, layout.tiers[i].attr);
            }
        }

        return (false, 0, 0);
    }

    function _maybeIssueOrUpgradeByPointsBalance(
        address user,
        address erc1155Addr,
        Layout storage layout
    ) internal {
        if (layout.tiers.length == 0) return;

        _syncActiveToBestValid(user, erc1155Addr, layout);

        ERC1155 token = ERC1155(erc1155Addr);
        uint256 points = token.balanceOf(user, POINTS_ID);

        (bool okTier, uint256 tierIdx, uint256 attr) = _tierFromPointsValue(points, layout);
        if (!okTier) return;

        uint256 currentActiveId = layout.activeMembershipId[user];
        if (currentActiveId != 0 && !_isExpired(currentActiveId, layout)) {
            uint256 currentTierIdx = layout.activeTierIndexOrMax[user];
            if (currentTierIdx <= tierIdx) return;
        }

        uint256 expiry = (layout.expirySeconds == 0) ? 0 : (block.timestamp + layout.expirySeconds);

        // IMPORTANT: ensure layout.currentIndex is initialized to NFT_START_ID (100) elsewhere
        uint256 newId = layout.currentIndex++;

        layout.expiresAt[newId] = expiry;
        layout.attributes[newId] = attr;
        layout.tokenTierIndexOrMax[newId] = tierIdx;
        layout.userOwnedNfts[user].push(newId);

        if (currentActiveId != 0) {
            emit MemberNFTUpgraded(user, currentActiveId, newId, layout.activeTierIndexOrMax[user], tierIdx, expiry);
        } else {
            emit MemberNFTIssued(user, newId, tierIdx, layout.tiers[tierIdx].minUsdc6, expiry);
        }

        layout.activeMembershipId[user] = newId;
        layout.activeTierIndexOrMax[user] = tierIdx;
    }

    function _maybeUpgradeOnlyByPointsBalance(
        address user,
        address erc1155Addr,
        Layout storage layout
    ) internal {
        if (layout.tiers.length == 0) return;

        _syncActiveToBestValid(user, erc1155Addr, layout);

        ERC1155 token = ERC1155(erc1155Addr);
        uint256 points = token.balanceOf(user, POINTS_ID);

        (bool okTier, uint256 tierIdx, uint256 attr) = _tierFromPointsValue(points, layout);

        uint256 currentActiveId = layout.activeMembershipId[user];
        if (currentActiveId == 0 || _isExpired(currentActiveId, layout)) {
            if (okTier) {
                _maybeIssueOrUpgradeByPointsBalance(user, erc1155Addr, layout);
            }
            return;
        }

        uint256 currentTierIdx = layout.activeTierIndexOrMax[user];
        if (!okTier || currentTierIdx <= tierIdx) return;

        uint256 expiry = (layout.expirySeconds == 0) ? 0 : (block.timestamp + layout.expirySeconds);
        uint256 newId = layout.currentIndex++;

        layout.expiresAt[newId] = expiry;
        layout.attributes[newId] = attr;
        layout.tokenTierIndexOrMax[newId] = tierIdx;
        layout.userOwnedNfts[user].push(newId);

        emit MemberNFTUpgraded(user, currentActiveId, newId, currentTierIdx, tierIdx, expiry);

        layout.activeMembershipId[user] = newId;
        layout.activeTierIndexOrMax[user] = tierIdx;
    }

    function _removeNft(address user, uint256 id, Layout storage layout) internal {
        uint256[] storage list = layout.userOwnedNfts[user];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == id) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
        if (layout.activeMembershipId[user] == id) {
            layout.activeMembershipId[user] = 0;
            layout.activeTierIndexOrMax[user] = type(uint256).max;
        }
    }

    // ==========================================================
    // Faucet Logic
    // ==========================================================

    function _validateFaucetConfig(Faucet memory cfg) internal pure {
        if (!cfg.enabled && cfg.validUntil == 0) revert UC_FaucetConfigInvalid();
        if (cfg.decimals != 6) revert UC_FaucetConfigInvalid();
        if (cfg.perClaimMax == 0) revert UC_FaucetConfigInvalid();
        if (cfg.maxPerUser == 0 || cfg.maxGlobal == 0) revert UC_FaucetConfigInvalid();
    }

    function faucetByGateway(
        address userEOA,
        uint256 id,
        uint256 amount,
        address gateway,
        address erc1155Addr,
        Layout storage layout
    ) internal returns (address acct, uint256 claimedAfter) {
        if (userEOA == address(0)) revert BM_ZeroAddress();
        if (amount == 0) revert UC_AmountZero();

        Faucet storage cfg = layout.faucetConfig[id];
        if (!cfg.enabled) revert UC_FaucetNotEnabled();
        if (block.timestamp > cfg.validUntil) revert UC_FaucetExpired();
        if (amount > cfg.perClaimMax) revert UC_FaucetAmountTooLarge();
        if (!IBeamioFactoryOracle(gateway).isTokenIdIssued(erc1155Addr, id)) revert UC_FaucetIdNotIssued();
        if (cfg.priceInCurrency6 != 0) revert UC_FaucetDisabledBecausePriced();

        mapping(address => uint256) storage claimed = layout.faucetClaimed[id];
        if (claimed[userEOA] + amount > cfg.maxPerUser) revert UC_FaucetMaxExceeded();
        if (layout.faucetGlobalMinted[id] + amount > cfg.maxGlobal) revert UC_FaucetGlobalMaxExceeded();

        claimed[userEOA] += amount;
        layout.faucetGlobalMinted[id] += amount;

        acct = _resolveAccount(userEOA, gateway);
        claimedAfter = claimed[userEOA];

        emit FaucetClaimed(id, userEOA, acct, amount, claimedAfter);
    }

    function faucetPurchaseWith3009AuthorizationByGateway(
        address userEOA,
        uint256 id,
        uint256 amount6,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature,
        address gateway,
        address merchant,
        address erc1155Addr,
        Layout storage layout
    ) internal returns (address acct, uint256 claimedAfter, uint256 usdcAmount6) {
        if (userEOA == address(0)) revert BM_ZeroAddress();
        if (amount6 == 0) revert UC_AmountZero();

        Faucet storage cfg = layout.faucetConfig[id];
        if (!cfg.enabled) revert UC_FaucetNotEnabled();
        if (block.timestamp > cfg.validUntil) revert UC_FaucetExpired();
        if (amount6 > cfg.perClaimMax) revert UC_FaucetAmountTooLarge();
        if (!IBeamioFactoryOracle(gateway).isTokenIdIssued(erc1155Addr, id)) revert UC_FaucetIdNotIssued();
        if (cfg.priceInCurrency6 == 0) revert UC_PurchaseDisabledBecauseFree();

        mapping(address => uint256) storage claimed = layout.faucetClaimed[id];
        if (claimed[userEOA] + amount6 > cfg.maxPerUser) revert UC_FaucetMaxExceeded();
        if (layout.faucetGlobalMinted[id] + amount6 > cfg.maxGlobal) revert UC_FaucetGlobalMaxExceeded();

        usdcAmount6 =
            IBeamioFactoryOracle(gateway).quoteCurrencyAmountInUSDC6(cfg.currency, (uint256(cfg.priceInCurrency6) * amount6) / 1e6);

        _executeUSDC3009Transfer(userEOA, usdcAmount6, validAfter, validBefore, nonce, signature, gateway, merchant);

        claimed[userEOA] += amount6;
        layout.faucetGlobalMinted[id] += amount6;

        acct = _resolveAccount(userEOA, gateway);
        claimedAfter = claimed[userEOA];

        emit FaucetClaimed(id, userEOA, acct, amount6, claimedAfter);
    }

    // ==========================================================
    // Points Purchase
    // ==========================================================

    function _collectUSDCAndEmitMintPoints(
        address fromEOA,
        address acct,
        uint256 usdcAmount6,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature,
        uint256 pointsOut6,
        uint256 unitPriceUsdc6,
        address gateway,
        address merchant
    ) internal {
        _executeUSDC3009Transfer(fromEOA, usdcAmount6, validAfter, validBefore, nonce, signature, gateway, merchant);

        emit PointsPurchasedWithUSDC(
            fromEOA,
            acct,
            IBeamioFactoryOracle(gateway).USDC(),
            usdcAmount6,
            pointsOut6,
            unitPriceUsdc6,
            nonce
        );
    }

    function _executeUSDC3009Transfer(
        address fromEOA,
        uint256 val,
        uint256 afterTs,
        uint256 beforeTs,
        bytes32 nonce,
        bytes calldata sig,
        address gateway,
        address merchant
    ) internal {
        address usdc = IBeamioFactoryOracle(gateway).USDC();
        if (usdc == address(0)) revert BM_ZeroAddress();
        if (merchant == address(0)) revert BM_ZeroAddress();

        IERC3009BytesSig(usdc).transferWithAuthorization(fromEOA, merchant, val, afterTs, beforeTs, nonce, sig);
    }

    // ==========================================================
    // AA Account Resolve
    // ==========================================================

    function _resolveAccount(address eoa, address gateway) internal view returns (address) {
        address factory = IBeamioFactoryOracle(gateway).aaFactory();
        if (factory == address(0)) revert UC_GlobalMisconfigured();

        address acct = IBeamioAccountFactoryV07(factory).beamioAccountOf(eoa);
        if (acct == address(0) || acct.code.length == 0) revert UC_NoBeamioAccount();
        return acct;
    }

    // ==========================================================
    // Views
    // ==========================================================

    function getOwnershipDetails(
        address user,
        address erc1155Addr,
        Layout storage layout
    ) internal view returns (uint256 pt, NFTDetail[] memory nfts) {
        uint256[] storage nftIds = layout.userOwnedNfts[user];
        nfts = new NFTDetail[](nftIds.length);

        ERC1155 token = ERC1155(erc1155Addr);
        for (uint256 i = 0; i < nftIds.length; i++) {
            uint256 id = nftIds[i];
            uint256 exp = layout.expiresAt[id];
            bool expired = (exp != 0 && block.timestamp > exp);

            nfts[i] = NFTDetail(id, layout.attributes[id], layout.tokenTierIndexOrMax[id], exp, expired);
        }

        return (token.balanceOf(user, POINTS_ID), nfts);
    }

    // ==========================================================
    // Extra: simple helpers used by callers
    // ==========================================================

    function pointsOne() internal pure returns (uint256) {
        return POINTS_ONE;
    }
}
