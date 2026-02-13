// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Errors.sol";

/* =========================================================
   RedeemStorage (delegatecall storage in card)
   - NO magic hex slot: use keccak256("...") constant
   ========================================================= */

library RedeemStorage {
    bytes32 internal constant SLOT = keccak256("beamio.usercard.redeem.storage.v1");

    // ===== One-time Redeem =====
    struct Redeem {
        uint128 points6;
        uint32  attr;
        bool    active;

        uint64  validAfter;   // 0 => immediate
        uint64  validBefore;  // 0 => forever

        uint256[] tokenIds;
        uint256[] amounts;
    }

    // ===== RedeemPool (repeatable password; each user once) =====
    struct PoolContainer {
        uint32 remaining;
        uint256[] tokenIds;
        uint256[] amounts;
    }

    struct RedeemPool {
        bool   active;
        uint64 validAfter;
        uint64 validBefore;

        uint32 totalRemaining;
        uint32 cursor;

        PoolContainer[] containers;
    }

    struct Layout {
        mapping(bytes32 => Redeem) redeems;

        mapping(bytes32 => RedeemPool) pools;
        mapping(bytes32 => mapping(address => bool)) poolClaimed;  // poolHash => user => claimed，每轮新 password 即新 poolHash
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = SLOT;
        assembly { l.slot := slot }
    }
}

/* =========================
   Context interfaces (delegatecall)
   ========================= */

interface IUserCardCtx {
    function owner() external view returns (address);
    function factoryGateway() external view returns (address);
}

/**
 * @title BeamioUserCardRedeemModuleVNext
 * @notice Delegatecall module. Storage lives in the UserCard (via SLOT).
 */
contract BeamioUserCardRedeemModuleVNext {
    using RedeemStorage for RedeemStorage.Layout;

    // ===== events =====
    event RedeemCreated(bytes32 indexed hash, uint256 points6, uint256 attr, uint64 validAfter, uint64 validBefore, uint256 bundleLen);
    event RedeemCancelled(bytes32 indexed hash);
    event RedeemConsumed(bytes32 indexed hash, address indexed user, uint256 points6, uint256 attr, uint64 validAfter, uint64 validBefore, uint256 bundleLen);

    event RedeemPoolCreated(bytes32 indexed poolHash, uint64 validAfter, uint64 validBefore, uint256 containerTypes, uint256 totalRemaining);
    event RedeemPoolTerminated(bytes32 indexed poolHash);
    event RedeemPoolConsumed(bytes32 indexed poolHash, address indexed user, uint256 containerIndex, uint256 bundleLen);

    // ==========================================================
    // access control (card owner OR gateway)
    // ==========================================================
    modifier onlyOwnerOrGateway() {
        address cardOwner = IUserCardCtx(address(this)).owner();
        address gw = IUserCardCtx(address(this)).factoryGateway();
        if (msg.sender != cardOwner && msg.sender != gw) revert BM_NotAuthorized();
        _;
    }

    // ==========================================================
    // helpers
    // ==========================================================
    function _validateBundle(uint256[] calldata tokenIds, uint256[] calldata amounts) internal pure {
        if (tokenIds.length != amounts.length) revert UC_InvalidProposal();
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) revert UC_AmountZero();
        }
    }

    function _timeOk(uint64 validAfter, uint64 validBefore) internal view returns (bool) {
        uint256 nowTs = block.timestamp;
        if (validAfter != 0 && nowTs < validAfter) return false;
        if (validBefore != 0 && nowTs > validBefore) return false;
        return true;
    }

    function _wipeRedeemArrays(RedeemStorage.Redeem storage r) internal {
        if (r.tokenIds.length != 0) delete r.tokenIds;
        if (r.amounts.length != 0) delete r.amounts;
    }

    // ==========================================================
    // One-time Redeem
    // ==========================================================
    function createRedeem(
        bytes32 hash,
        uint256 points6,
        uint256 attr,
        uint64 validAfter,
        uint64 validBefore,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) external onlyOwnerOrGateway {
        if (hash == bytes32(0)) revert BM_InvalidSecret();
        _validateBundle(tokenIds, amounts);

        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.Redeem storage r = l.redeems[hash];
        if (r.active) revert UC_InvalidProposal();

        _wipeRedeemArrays(r);

        r.points6 = uint128(points6);
        r.attr = uint32(attr);
        r.validAfter = validAfter;
        r.validBefore = validBefore;
        r.active = true;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            r.tokenIds.push(tokenIds[i]);
            r.amounts.push(amounts[i]);
        }

        emit RedeemCreated(hash, points6, attr, validAfter, validBefore, tokenIds.length);
    }

    function cancelRedeem(string calldata code) external onlyOwnerOrGateway {
        bytes memory b = bytes(code);
        if (b.length == 0) revert BM_InvalidSecret();
        bytes32 hash = keccak256(b);

        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.Redeem storage r = l.redeems[hash];
        if (!r.active) revert UC_InvalidProposal();

        r.active = false;
        _wipeRedeemArrays(r);

        emit RedeemCancelled(hash);
    }

    function consumeRedeem(string calldata code, address to)
        external
        returns (uint256 points6, uint256 attr, uint256[] memory tokenIds, uint256[] memory amounts)
    {
        if (to == address(0)) revert BM_ZeroAddress();

        bytes memory b = bytes(code);
        if (b.length == 0) revert BM_InvalidSecret();
        bytes32 hash = keccak256(b);

        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.Redeem storage r = l.redeems[hash];

        if (!r.active) revert UC_InvalidProposal();
        if (!_timeOk(r.validAfter, r.validBefore)) revert UC_InvalidTimeWindow(block.timestamp, r.validAfter, r.validBefore);

        r.active = false;

        points6 = r.points6;
        attr = r.attr;

        uint256 n = r.tokenIds.length;
        tokenIds = new uint256[](n);
        amounts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            tokenIds[i] = r.tokenIds[i];
            amounts[i] = r.amounts[i];
        }

        _wipeRedeemArrays(r);

        emit RedeemConsumed(hash, to, points6, attr, r.validAfter, r.validBefore, n);
        return (points6, attr, tokenIds, amounts);
    }

    // ==========================================================
    // RedeemPool
    // ==========================================================
    function createRedeemPool(
        bytes32 poolHash,
        uint64 validAfter,
        uint64 validBefore,
        uint256[][] calldata tokenIdsList,
        uint256[][] calldata amountsList,
        uint32[] calldata counts
    ) external onlyOwnerOrGateway {
        if (poolHash == bytes32(0)) revert BM_InvalidSecret();

        uint256 m = tokenIdsList.length;
        if (m == 0) revert UC_InvalidProposal();
        if (amountsList.length != m || counts.length != m) revert UC_InvalidProposal();

        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.RedeemPool storage p = l.pools[poolHash];
        if (p.active) revert UC_InvalidProposal();

        // reset whole pool storage for reuse
        delete l.pools[poolHash];

        RedeemStorage.RedeemPool storage p2 = l.pools[poolHash];
        p2.active = true;
        p2.validAfter = validAfter;
        p2.validBefore = validBefore;
        p2.cursor = 0;

        uint256 total = 0;

        for (uint256 i = 0; i < m; i++) {
            _validateBundle(tokenIdsList[i], amountsList[i]);
            if (counts[i] == 0) revert UC_InvalidProposal();

            p2.containers.push();
            RedeemStorage.PoolContainer storage c = p2.containers[i];
            c.remaining = counts[i];

            for (uint256 j = 0; j < tokenIdsList[i].length; j++) {
                c.tokenIds.push(tokenIdsList[i][j]);
                c.amounts.push(amountsList[i][j]);
            }

            total += counts[i];
        }

        p2.totalRemaining = uint32(total);
        emit RedeemPoolCreated(poolHash, validAfter, validBefore, m, total);
    }

    function terminateRedeemPool(bytes32 poolHash) external onlyOwnerOrGateway {
        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.RedeemPool storage p = l.pools[poolHash];

        if (!p.active) revert UC_InvalidProposal();
        p.active = false;

        emit RedeemPoolTerminated(poolHash);
    }

    function consumeRedeemPool(string calldata code, address user)
        external
        returns (uint256[] memory tokenIds, uint256[] memory amounts)
    {
        if (user == address(0)) revert BM_ZeroAddress();

        bytes memory b = bytes(code);
        if (b.length == 0) revert BM_InvalidSecret();
        bytes32 poolHash = keccak256(b);

        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.RedeemPool storage p = l.pools[poolHash];

        if (!p.active) revert UC_InvalidProposal();
        if (!_timeOk(p.validAfter, p.validBefore)) revert UC_InvalidTimeWindow(block.timestamp, p.validAfter, p.validBefore);
        if (p.totalRemaining == 0) revert UC_InvalidProposal();
        if (l.poolClaimed[poolHash][user]) revert UC_PoolAlreadyClaimed(poolHash, user);

        l.poolClaimed[poolHash][user] = true;

        uint256 m = p.containers.length;
        uint256 idx = p.cursor;

        for (uint256 k = 0; k < m; k++) {
            uint256 i = (idx + k) % m;
            if (p.containers[i].remaining != 0) {
                idx = i;
                break;
            }
            if (k == m - 1) revert UC_InvalidProposal();
        }

        RedeemStorage.PoolContainer storage c = p.containers[idx];
        c.remaining -= 1;
        p.totalRemaining -= 1;

        p.cursor = uint32((idx + 1) % m);

        uint256 n = c.tokenIds.length;
        tokenIds = new uint256[](n);
        amounts = new uint256[](n);

        for (uint256 j = 0; j < n; j++) {
            tokenIds[j] = c.tokenIds[j];
            amounts[j] = c.amounts[j];
        }

        emit RedeemPoolConsumed(poolHash, user, idx, n);
        return (tokenIds, amounts);
    }
}
