// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library RedeemStorage {
    // keccak256("beamio.redeem.storage.vNext")
    bytes32 internal constant SLOT =
        0x1111111111111111111111111111111111111111111111111111111111111111;

    // ===== 普通 Redeem（一次性）=====
    struct Redeem {
        uint128 points6;
        uint32  attr;
        bool    active;

        uint64  validAfter;   // 0 => immediate
        uint64  validBefore;  // 0 => forever

        uint256[] tokenIds;
        uint256[] amounts;
    }

    // ===== 红包池 RedeemPool（可重复使用密码，多用户各领一次）=====
    struct PoolContainer {
        uint32 remaining;     // 该模板剩余份数
        uint256[] tokenIds;
        uint256[] amounts;
    }

    struct RedeemPool {
        bool   active;
        uint64 validAfter;    // 0 => immediate
        uint64 validBefore;   // 0 => forever

        uint32 totalRemaining; // 所有模板总剩余
        uint32 cursor;         // consume 时从 cursor 往后找 remaining>0（省 gas）

        PoolContainer[] containers;
    }

    struct Layout {
        mapping(bytes32 => Redeem) redeems;

        mapping(bytes32 => RedeemPool) pools;                 // poolHash => pool
        mapping(bytes32 => mapping(address => bool)) claimed; // poolHash => (user => claimedOnce)
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = SLOT;
        assembly { l.slot := slot }
    }
}

contract RedeemModule {
    using RedeemStorage for RedeemStorage.Layout;

    // ===== events =====
    event RedeemCreated(bytes32 indexed hash, uint256 points6, uint256 attr, uint64 validAfter, uint64 validBefore, uint256 bundleLen);
    event RedeemCancelled(bytes32 indexed hash);
    event RedeemConsumed(bytes32 indexed hash, address indexed user, uint256 points6, uint256 attr, uint64 validAfter, uint64 validBefore, uint256 bundleLen);

    event RedeemPoolCreated(bytes32 indexed poolHash, uint64 validAfter, uint64 validBefore, uint256 containerTypes, uint256 totalRemaining);
    event RedeemPoolTerminated(bytes32 indexed poolHash);
    event RedeemPoolConsumed(bytes32 indexed poolHash, address indexed user, uint256 containerIndex, uint256 bundleLen);

    // ==========================================================
    // helpers
    // ==========================================================
    function _validateBundle(uint256[] calldata tokenIds, uint256[] calldata amounts) internal pure {
        require(tokenIds.length == amounts.length, "len mismatch");
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(amounts[i] != 0, "amt=0");
        }
    }

    function _timeOk(uint64 validAfter, uint64 validBefore) internal view returns (bool) {
        uint256 nowTs = block.timestamp;
        if (validAfter != 0 && nowTs < validAfter) return false;
        if (validBefore != 0 && nowTs > validBefore) return false;
        return true;
    }

    function _wipeArraysRedeem(RedeemStorage.Redeem storage r) internal {
        if (r.tokenIds.length != 0) delete r.tokenIds;
        if (r.amounts.length != 0) delete r.amounts;
    }

    function _wipeArraysContainer(RedeemStorage.PoolContainer storage c) internal {
        if (c.tokenIds.length != 0) delete c.tokenIds;
        if (c.amounts.length != 0) delete c.amounts;
    }

    // ==========================================================
    // 普通 Redeem：create / cancel(string) / consume(string)
    // ==========================================================
    function createRedeem(
        bytes32 hash,
        uint256 points6,
        uint256 attr,
        uint64 validAfter,
        uint64 validBefore,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) external {
        require(hash != bytes32(0), "hash=0");
        _validateBundle(tokenIds, amounts);

        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.Redeem storage r = l.redeems[hash];
        require(!r.active, "exists");

        _wipeArraysRedeem(r);

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

    // 你当前 cancel 是 string：保留（过期也允许 cancel）
    function cancelRedeem(string calldata code) external {
        bytes32 hash = keccak256(bytes(code));

        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.Redeem storage r = l.redeems[hash];

        require(r.active, "inactive");
        r.active = false;
        _wipeArraysRedeem(r);

        emit RedeemCancelled(hash);
    }

    // consume：必须在时间窗内，否则不能领取（只能 cancel）
    function consumeRedeem(string calldata code, address to)
        external
        returns (uint256 points6, uint256 attr, uint256[] memory tokenIds, uint256[] memory amounts)
    {
        bytes32 hash = keccak256(bytes(code));

        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.Redeem storage r = l.redeems[hash];

        require(r.active, "invalid redeem");
        require(_timeOk(r.validAfter, r.validBefore), "time");

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

        _wipeArraysRedeem(r);

        emit RedeemConsumed(hash, to, points6, attr, r.validAfter, r.validBefore, n);
        return (points6, attr, tokenIds, amounts);
    }

    // ==========================================================
    // RedeemPool（三件套）
    //  - 一个 poolHash 可被多人重复使用
    //  - 每人只能领一次
    //  - pool 有容器模板 + 份数，领一次消耗一份
    // ==========================================================
    function createRedeemPool(
        bytes32 poolHash,
        uint64 validAfter,
        uint64 validBefore,
        uint256[][] calldata tokenIdsList,
        uint256[][] calldata amountsList,
        uint32[] calldata counts
    ) external {
        require(poolHash != bytes32(0), "hash=0");

        uint256 m = tokenIdsList.length;
        require(m != 0, "containers=0");
        require(amountsList.length == m, "len mismatch");
        require(counts.length == m, "len mismatch");

        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.RedeemPool storage p = l.pools[poolHash];
        require(!p.active, "exists");

        // 清理旧数据（如果之前 terminate 后复用同 hash）
        // 这里直接 delete 整个 pools[poolHash] 最省事
        delete l.pools[poolHash];

        RedeemStorage.RedeemPool storage p2 = l.pools[poolHash];
        p2.active = true;
        p2.validAfter = validAfter;
        p2.validBefore = validBefore;
        p2.cursor = 0;

        uint256 total = 0;

        for (uint256 i = 0; i < m; i++) {
            _validateBundle(tokenIdsList[i], amountsList[i]);
            require(counts[i] != 0, "count=0");

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

    // owner 可随时终止
    function terminateRedeemPool(bytes32 poolHash) external {
        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.RedeemPool storage p = l.pools[poolHash];

        require(p.active, "inactive");
        p.active = false;

        emit RedeemPoolTerminated(poolHash);
    }

    // 用户凭密码领取一次：重复使用密码，但每个 user 只能领一次
    function consumeRedeemPool(string calldata code, address user)
        external
        returns (uint256[] memory tokenIds, uint256[] memory amounts)
    {
        bytes32 poolHash = keccak256(bytes(code));

        RedeemStorage.Layout storage l = RedeemStorage.layout();
        RedeemStorage.RedeemPool storage p = l.pools[poolHash];

        require(p.active, "inactive");
        require(_timeOk(p.validAfter, p.validBefore), "time");
        require(p.totalRemaining != 0, "empty");
        require(!l.claimed[poolHash][user], "claimed");

        l.claimed[poolHash][user] = true;

        // 找一个还有 remaining 的 container
        uint256 m = p.containers.length;
        uint256 idx = p.cursor;

        for (uint256 k = 0; k < m; k++) {
            uint256 i = (idx + k) % m;
            if (p.containers[i].remaining != 0) {
                idx = i;
                break;
            }
            if (k == m - 1) revert("empty");
        }

        RedeemStorage.PoolContainer storage c = p.containers[idx];
        c.remaining -= 1;
        p.totalRemaining -= 1;

        // 更新 cursor（下次从这里继续找）
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
