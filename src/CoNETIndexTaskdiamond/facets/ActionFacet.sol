// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibDiamond} from "../libraries/LibDiamond.sol";
import {LibActionStorage} from "../libraries/LibActionStorage.sol";
import {LibStatsStorage} from "../libraries/LibStatsStorage.sol";
import {LibAdminStorage} from "../libraries/LibAdminStorage.sol";

contract ActionFacet {
    uint8 public constant PERIOD_HOUR = 0;
    uint8 public constant PERIOD_DAY = 1;
    uint8 public constant PERIOD_WEEK = 2;
    uint8 public constant PERIOD_MONTH = 3;
    uint8 public constant PERIOD_QUARTER = 4;
    uint8 public constant PERIOD_YEAR = 5;
    uint8 public constant ACCOUNT_MODE_ALL = 0;
    uint8 public constant ACCOUNT_MODE_EOA = 1;
    uint8 public constant ACCOUNT_MODE_AA = 2;
    uint16 public constant GAS_CHAIN_FILTER_ALL = type(uint16).max;
    uint256 public constant CHAIN_ID_FILTER_ALL = type(uint256).max;
    uint256 public constant ATOMIC_BUCKET_SECONDS = 3600;

    event StatsUpdated(uint256 indexed hourIndex, address indexed account);
    event TransactionRecordSynced(
        uint256 indexed actionId,
        bytes32 indexed txId,
        bytes32 indexed txCategory,
        address payer,
        address payee
    );
    event AfterNotesUpdated(uint256 indexed actionId);

    struct RouteItemInput {
        address asset;
        uint256 amountE6;
        uint8 assetType;
        uint8 source;
        uint256 tokenId;
        uint8 itemCurrencyType;
        uint256 offsetInRequestCurrencyE6;
    }

    struct FeeInfoInput {
        uint16 gasChainType;
        uint256 gasWei;
        uint256 gasUSDC6;
        uint256 serviceUSDC6;
        uint256 bServiceUSDC6;
        uint256 bServiceUnits6;
        address feePayer;
    }

    struct TransactionMetaInput {
        uint256 requestAmountFiat6;
        uint256 requestAmountUSDC6;
        uint8 currencyFiat;
        uint256 discountAmountFiat6;
        uint16 discountRateBps;
        uint256 taxAmountFiat6;
        uint16 taxRateBps;
        string afterNotePayer;
        string afterNotePayee;
    }

    struct TransactionInput {
        bytes32 txId;
        bytes32 originalPaymentHash;
        uint256 chainId;
        bytes32 txCategory;
        string displayJson;
        uint64 timestamp;
        address payer;
        address payee;
        uint256 finalRequestAmountFiat6;
        uint256 finalRequestAmountUSDC6;
        bool isAAAccount;
        RouteItemInput[] route;
        FeeInfoInput fees;
        TransactionMetaInput meta;
    }

    // 完整返回模型：与 readme Transaction 结构对齐（含 route）
    struct TransactionFull {
        bytes32 id;
        bytes32 originalPaymentHash;
        uint256 chainId;
        bytes32 txCategory;
        string displayJson;
        uint64 timestamp;
        address payer;
        address payee;
        uint256 finalRequestAmountFiat6;
        uint256 finalRequestAmountUSDC6;
        bool isAAAccount;
        LibActionStorage.RouteItem[] route;
        LibActionStorage.FeeInfo fees;
        LibActionStorage.TransactionMeta meta;
    }

    // bService 统计结果（支持窗口总量 + 分页页内总量）
    struct FeeStatsPage {
        uint256 total;
        uint256 periodStart;
        uint256 periodEnd;
        uint256 windowBServiceUnits6;
        uint256 windowBServiceUSDC6;
        uint256 pageBServiceUnits6;
        uint256 pageBServiceUSDC6;
        uint256[] actionIds;
    }

    function _enforceIsOwnerOrAdmin() internal view {
        if (msg.sender == LibDiamond.contractOwner()) return;
        require(LibAdminStorage.layout().isAdmin[msg.sender], "not admin");
    }

    function syncTokenAction(TransactionInput calldata in_) external returns (uint256 actionId) {
        _enforceIsOwnerOrAdmin();

        require(in_.txId != bytes32(0), "txId=0");
        require(in_.chainId > 0, "chainId=0");
        require(in_.payer != address(0), "payer=0");
        require(in_.payee != address(0), "payee=0");
        if (in_.isAAAccount) require(in_.route.length > 0, "route required");
        require(
            in_.fees.gasChainType <= uint16(LibActionStorage.GasChainType.SOLANA),
            "bad gasChainType"
        );

        LibActionStorage.Layout storage a = LibActionStorage.layout();
        require(a.actionIdPlusOneByTxId[in_.txId] == 0, "tx exists");

        actionId = a.txCount;
        a.txCount = actionId + 1;

        uint256 useTs = in_.timestamp == 0 ? block.timestamp : uint256(in_.timestamp);
        LibActionStorage.TransactionRecord storage txr = a.txRecordByActionId[actionId];

        txr.id = in_.txId;
        txr.originalPaymentHash = in_.originalPaymentHash;
        txr.chainId = in_.chainId;
        txr.txCategory = in_.txCategory;
        txr.displayJson = in_.displayJson;
        txr.timestamp = uint64(useTs);
        txr.payer = in_.payer;
        txr.payee = in_.payee;
        txr.finalRequestAmountFiat6 = in_.finalRequestAmountFiat6;
        txr.finalRequestAmountUSDC6 = in_.finalRequestAmountUSDC6;
        txr.isAAAccount = in_.isAAAccount;
        txr.exists = true;

        txr.fees = LibActionStorage.FeeInfo({
            gasChainType: in_.fees.gasChainType,
            gasWei: in_.fees.gasWei,
            gasUSDC6: in_.fees.gasUSDC6,
            serviceUSDC6: in_.fees.serviceUSDC6,
            bServiceUSDC6: in_.fees.bServiceUSDC6,
            bServiceUnits6: in_.fees.bServiceUnits6,
            feePayer: in_.fees.feePayer
        });

        txr.meta = LibActionStorage.TransactionMeta({
            requestAmountFiat6: in_.meta.requestAmountFiat6,
            requestAmountUSDC6: in_.meta.requestAmountUSDC6,
            currencyFiat: in_.meta.currencyFiat,
            discountAmountFiat6: in_.meta.discountAmountFiat6,
            discountRateBps: in_.meta.discountRateBps,
            taxAmountFiat6: in_.meta.taxAmountFiat6,
            taxRateBps: in_.meta.taxRateBps,
            afterNotePayer: in_.meta.afterNotePayer,
            afterNotePayee: in_.meta.afterNotePayee
        });

        LibActionStorage.RouteItem[] storage routeStore = a.routeByActionId[actionId];
        for (uint256 i = 0; i < in_.route.length; i++) {
            RouteItemInput calldata r = in_.route[i];
            require(r.asset != address(0), "route.asset=0");
            require(r.amountE6 > 0, "route.amount=0");
            require(r.assetType <= uint8(LibActionStorage.AssetType.ERC1155), "bad assetType");
            require(r.source <= uint8(LibActionStorage.RouteSource.TipAppend), "bad route source");

            routeStore.push(
                LibActionStorage.RouteItem({
                    asset: r.asset,
                    amountE6: r.amountE6,
                    assetType: LibActionStorage.AssetType(r.assetType),
                    source: LibActionStorage.RouteSource(r.source),
                    tokenId: r.tokenId,
                    itemCurrencyType: r.itemCurrencyType,
                    offsetInRequestCurrencyE6: r.offsetInRequestCurrencyE6
                })
            );

            _indexAssetAction(a, r.asset, actionId);
            _indexAssetTokenAction(a, r.asset, r.tokenId, actionId);
            _applyAssetTokenTransfer(a, r.asset, r.tokenId, in_.payer, in_.payee, r.amountE6, uint64(useTs / 3600));
        }

        a.actionIdPlusOneByTxId[in_.txId] = actionId + 1;
        a.accountActionIds[in_.payer].push(actionId);
        if (in_.payee != in_.payer) a.accountActionIds[in_.payee].push(actionId);
        if (in_.fees.feePayer != address(0)) {
            a.feePayerActionIds[in_.fees.feePayer].push(actionId);
            if (in_.fees.bServiceUnits6 > 0 && !a.bServiceSeenAccountIndexed[in_.fees.feePayer]) {
                a.bServiceSeenAccountIndexed[in_.fees.feePayer] = true;
                a.bServiceSeenAccounts.push(in_.fees.feePayer);
            }
        }

        _recordTxStats(useTs, in_.payer, in_.payee);
        emit TransactionRecordSynced(actionId, in_.txId, in_.txCategory, in_.payer, in_.payee);
    }

    function _indexAssetAction(
        LibActionStorage.Layout storage a,
        address asset,
        uint256 actionId
    ) internal {
        if (!a.assetActionIndexed[asset][actionId]) {
            a.assetActionIndexed[asset][actionId] = true;
            a.assetActionIds[asset].push(actionId);
        }
    }

    function _indexAssetTokenAction(
        LibActionStorage.Layout storage a,
        address asset,
        uint256 tokenId,
        uint256 actionId
    ) internal {
        if (!a.assetTokenActionIndexed[asset][tokenId][actionId]) {
            a.assetTokenActionIndexed[asset][tokenId][actionId] = true;
            a.assetTokenActionIds[asset][tokenId].push(actionId);
        }
    }

    function _applyAssetTokenTransfer(
        LibActionStorage.Layout storage a,
        address asset,
        uint256 tokenId,
        address from,
        address to,
        uint256 amountE6,
        uint64 hourIndex
    ) internal {
        if (amountE6 == 0 || from == to) return;

        uint256 fromBal = a.indexedBalanceByAssetTokenAccount[asset][tokenId][from];
        uint256 debit = amountE6 > fromBal ? fromBal : amountE6;
        if (debit == 0) return;
        uint256 newFromBal = fromBal - debit;
        a.indexedBalanceByAssetTokenAccount[asset][tokenId][from] = newFromBal;
        if (fromBal > 0 && newFromBal == 0) {
            a.indexedHolderCountByAssetToken[asset][tokenId] -= 1;
        }
        _recordBalanceCheckpoint(a, asset, tokenId, from, newFromBal, hourIndex);

        uint256 toBal = a.indexedBalanceByAssetTokenAccount[asset][tokenId][to];
        if (toBal == 0) {
            a.indexedHolderCountByAssetToken[asset][tokenId] += 1;
        }
        // indexer 口径：若历史不完整导致 from 余额不足，按可扣减部分 debit 处理
        uint256 newToBal = toBal + debit;
        a.indexedBalanceByAssetTokenAccount[asset][tokenId][to] = newToBal;
        _recordBalanceCheckpoint(a, asset, tokenId, to, newToBal, hourIndex);
    }

    function _recordBalanceCheckpoint(
        LibActionStorage.Layout storage a,
        address asset,
        uint256 tokenId,
        address account,
        uint256 balanceE6,
        uint64 hourIndex
    ) internal {
        if (!a.assetTokenSeenAccountIndexed[asset][tokenId][account]) {
            a.assetTokenSeenAccountIndexed[asset][tokenId][account] = true;
            a.assetTokenSeenAccounts[asset][tokenId].push(account);
        }

        LibActionStorage.BalanceCheckpoint[] storage cps = a.assetTokenBalanceCheckpoints[asset][tokenId][account];
        uint256 len = cps.length;
        if (len > 0 && cps[len - 1].hourIndex == hourIndex) {
            cps[len - 1].balanceE6 = balanceE6;
            return;
        }
        cps.push(LibActionStorage.BalanceCheckpoint({hourIndex: hourIndex, balanceE6: balanceE6}));
    }

    function _recordTxStats(uint256 ts, address payer, address payee) internal {
        LibStatsStorage.Layout storage s = LibStatsStorage.layout();
        uint256 hourIndex = ts / 3600;
        _upd(s.hourlyData[hourIndex], 0, 0, 0, 1);
        _upd(s.userHourlyData[payer][hourIndex], 0, 0, 0, 1);
        emit StatsUpdated(hourIndex, payer);

        if (payee != payer) {
            _upd(s.userHourlyData[payee][hourIndex], 0, 0, 0, 1);
            emit StatsUpdated(hourIndex, payee);
        }
    }

    function _upd(
        LibStatsStorage.HourlyStats storage st,
        uint256 nft,
        uint256 mint,
        uint256 burn,
        uint256 trans
    ) internal {
        if (!st.hasData) st.hasData = true;
        st.nftMinted += nft;
        st.tokenMinted += mint;
        st.tokenBurned += burn;
        st.transferCount += trans;
    }

    function setAfterNotes(
        uint256 actionId,
        string calldata afterNotePayer,
        string calldata afterNotePayee
    ) external {
        _enforceIsOwnerOrAdmin();
        _requireActionExists(actionId);
        LibActionStorage.TransactionMeta storage m = LibActionStorage.layout().txRecordByActionId[actionId].meta;
        m.afterNotePayer = afterNotePayer;
        m.afterNotePayee = afterNotePayee;
        emit AfterNotesUpdated(actionId);
    }

    function getTransactionCount() external view returns (uint256) {
        return LibActionStorage.layout().txCount;
    }

    function getTransactionRecord(uint256 actionId)
        external
        view
        returns (LibActionStorage.TransactionRecord memory tx_, LibActionStorage.RouteItem[] memory route_)
    {
        _requireActionExists(actionId);
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        tx_ = a.txRecordByActionId[actionId];
        route_ = _copyRoute(a.routeByActionId[actionId]);
    }

    function getTransactionFull(uint256 actionId) external view returns (TransactionFull memory full_) {
        _requireActionExists(actionId);
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        full_ = _buildFullTransaction(a.txRecordByActionId[actionId], a.routeByActionId[actionId]);
    }

    function getTransactionRecordByTxId(bytes32 txId)
        external
        view
        returns (LibActionStorage.TransactionRecord memory tx_, LibActionStorage.RouteItem[] memory route_)
    {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        uint256 actionIdPlusOne = a.actionIdPlusOneByTxId[txId];
        require(actionIdPlusOne != 0, "tx not found");
        uint256 actionId = actionIdPlusOne - 1;
        tx_ = a.txRecordByActionId[actionId];
        route_ = _copyRoute(a.routeByActionId[actionId]);
    }

    function getTransactionFullByTxId(bytes32 txId) external view returns (TransactionFull memory full_) {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        uint256 actionIdPlusOne = a.actionIdPlusOneByTxId[txId];
        require(actionIdPlusOne != 0, "tx not found");
        uint256 actionId = actionIdPlusOne - 1;
        full_ = _buildFullTransaction(a.txRecordByActionId[actionId], a.routeByActionId[actionId]);
    }

    function getTransactionActionId(bytes32 txId) external view returns (uint256 actionId, bool exists) {
        uint256 actionIdPlusOne = LibActionStorage.layout().actionIdPlusOneByTxId[txId];
        if (actionIdPlusOne == 0) return (0, false);
        return (actionIdPlusOne - 1, true);
    }

    function getAccountActionCount(address account) external view returns (uint256) {
        return LibActionStorage.layout().accountActionIds[account].length;
    }

    function getAccountActionIdsPaged(address account, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page)
    {
        uint256[] storage ids = LibActionStorage.layout().accountActionIds[account];
        uint256 total = ids.length;
        if (offset >= total || limit == 0) return new uint256[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new uint256[](end - offset);
        for (uint256 i = 0; i < page.length; i++) page[i] = ids[offset + i];
    }

    function getAccountTransactionsPaged(address account, uint256 offset, uint256 limit)
        external
        view
        returns (LibActionStorage.TransactionRecord[] memory page)
    {
        uint256[] storage ids = LibActionStorage.layout().accountActionIds[account];
        uint256 total = ids.length;
        if (offset >= total || limit == 0) return new LibActionStorage.TransactionRecord[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        page = new LibActionStorage.TransactionRecord[](end - offset);
        for (uint256 i = 0; i < page.length; i++) {
            page[i] = a.txRecordByActionId[ids[offset + i]];
        }
    }

    function getAssetActionCount(address asset) external view returns (uint256) {
        return LibActionStorage.layout().assetActionIds[asset].length;
    }

    function getAssetActionIdsPaged(address asset, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page)
    {
        uint256[] storage ids = LibActionStorage.layout().assetActionIds[asset];
        uint256 total = ids.length;
        if (offset >= total || limit == 0) return new uint256[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new uint256[](end - offset);
        for (uint256 i = 0; i < page.length; i++) page[i] = ids[offset + i];
    }

    function getAssetTransactionsPaged(address asset, uint256 offset, uint256 limit)
        external
        view
        returns (LibActionStorage.TransactionRecord[] memory page)
    {
        uint256[] storage ids = LibActionStorage.layout().assetActionIds[asset];
        uint256 total = ids.length;
        if (offset >= total || limit == 0) return new LibActionStorage.TransactionRecord[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        page = new LibActionStorage.TransactionRecord[](end - offset);
        for (uint256 i = 0; i < page.length; i++) {
            page[i] = a.txRecordByActionId[ids[offset + i]];
        }
    }

    function getAssetTokenActionCount(address asset, uint256 tokenId) external view returns (uint256) {
        return LibActionStorage.layout().assetTokenActionIds[asset][tokenId].length;
    }

    function getAssetTokenActionIdsPaged(address asset, uint256 tokenId, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page)
    {
        uint256[] storage ids = LibActionStorage.layout().assetTokenActionIds[asset][tokenId];
        uint256 total = ids.length;
        if (offset >= total || limit == 0) return new uint256[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new uint256[](end - offset);
        for (uint256 i = 0; i < page.length; i++) page[i] = ids[offset + i];
    }

    function getAssetTokenTransactionsPaged(address asset, uint256 tokenId, uint256 offset, uint256 limit)
        external
        view
        returns (LibActionStorage.TransactionRecord[] memory page)
    {
        uint256[] storage ids = LibActionStorage.layout().assetTokenActionIds[asset][tokenId];
        uint256 total = ids.length;
        if (offset >= total || limit == 0) return new LibActionStorage.TransactionRecord[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        page = new LibActionStorage.TransactionRecord[](end - offset);
        for (uint256 i = 0; i < page.length; i++) {
            page[i] = a.txRecordByActionId[ids[offset + i]];
        }
    }

    function getAccountActionIdsByPeriodPaged(
        address account,
        uint8 periodType,
        uint256 anchorTs,
        uint256 offset,
        uint256 limit,
        bytes32 txCategoryFilter,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    ) external view returns (uint256 total, uint256 periodStart, uint256 periodEnd, uint256[] memory page) {
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidGasChainTypeFilter(gasChainTypeFilter), "bad gasChainType");
        require(_isValidChainIdFilter(chainIdFilter), "bad chainId");
        // 最小原子粒度为小时，不提供秒级查询
        require(anchorTs == 0 || anchorTs % ATOMIC_BUCKET_SECONDS == 0, "anchor not hour-aligned");
        uint256 useAnchor = anchorTs == 0 ? block.timestamp : anchorTs;
        (periodStart, periodEnd) = _resolveActionPeriodRange(useAnchor, periodType);

        LibActionStorage.Layout storage a = LibActionStorage.layout();
        uint256[] storage ids = a.accountActionIds[account];

        for (uint256 i = 0; i < ids.length; i++) {
            if (
                _matchByPeriodAndCategory(
                    a.txRecordByActionId[ids[i]],
                    periodStart,
                    periodEnd,
                    txCategoryFilter,
                    ACCOUNT_MODE_ALL,
                    gasChainTypeFilter,
                    chainIdFilter
                )
            ) {
                total++;
            }
        }

        if (offset >= total || limit == 0) {
            return (total, periodStart, periodEnd, new uint256[](0));
        }

        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new uint256[](end - offset);

        uint256 seen;
        uint256 outIdx;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 actionId = ids[i];
            if (
                !_matchByPeriodAndCategory(
                    a.txRecordByActionId[actionId],
                    periodStart,
                    periodEnd,
                    txCategoryFilter,
                    ACCOUNT_MODE_ALL,
                    gasChainTypeFilter,
                    chainIdFilter
                )
            ) {
                continue;
            }
            if (seen >= offset && seen < end) {
                page[outIdx] = actionId;
                outIdx++;
            }
            seen++;
            if (seen >= end) break;
        }
    }

    function getAccountTransactionsByPeriodPaged(
        address account,
        uint8 periodType,
        uint256 anchorTs,
        uint256 offset,
        uint256 limit,
        bytes32 txCategoryFilter,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        // 最小原子粒度为小时，不提供秒级查询
        require(anchorTs == 0 || anchorTs % ATOMIC_BUCKET_SECONDS == 0, "anchor not hour-aligned");
        uint256[] memory idsPage;
        (total, periodStart, periodEnd, idsPage) = this.getAccountActionIdsByPeriodPaged(
            account,
            periodType,
            anchorTs,
            offset,
            limit,
            txCategoryFilter,
            gasChainTypeFilter,
            chainIdFilter
        );

        LibActionStorage.Layout storage a = LibActionStorage.layout();
        page = new LibActionStorage.TransactionRecord[](idsPage.length);
        for (uint256 i = 0; i < idsPage.length; i++) {
            page[i] = a.txRecordByActionId[idsPage[i]];
        }
    }

    /**
     * @notice 基于“当前周期”并按 periodOffset 回溯查询
     * @dev periodOffset=0 当前周期；1 上一周期；2 上两周期...
     */
    function getAccountTransactionsByCurrentPeriodOffsetPaged(
        address account,
        uint8 periodType,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        require(_isValidActionPeriodType(periodType), "bad periodType");
        uint256 currentStart;
        (currentStart, ) = _resolveActionPeriodRange(block.timestamp, periodType);
        periodStart = _shiftPeriodStartBack(currentStart, periodType, periodOffset);
        periodEnd = _periodEndFromStart(periodStart, periodType);

        (total, page) = _getAccountTransactionsByRangePaged(
            account,
            periodStart,
            periodEnd,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            ACCOUNT_MODE_ALL
        );
    }

    /**
     * @notice 同 getAccountTransactionsByCurrentPeriodOffsetPaged，但增加 EOA/AA 过滤
     * @param accountMode 0=全部,1=EOA(isAAAccount=false),2=AA(isAAAccount=true)
     */
    function getAccountTransactionsByCurrentPeriodOffsetAndAccountModePaged(
        address account,
        uint8 periodType,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidAccountMode(accountMode), "bad accountMode");
        uint256 currentStart;
        (currentStart, ) = _resolveActionPeriodRange(block.timestamp, periodType);
        periodStart = _shiftPeriodStartBack(currentStart, periodType, periodOffset);
        periodEnd = _periodEndFromStart(periodStart, periodType);

        (total, page) = _getAccountTransactionsByRangePaged(
            account,
            periodStart,
            periodEnd,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    function getAccountTransactionsByCurrentPeriodOffsetAndAccountModePagedFull(
        address account,
        uint8 periodType,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, TransactionFull[] memory page)
    {
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidAccountMode(accountMode), "bad accountMode");
        uint256 currentStart;
        (currentStart, ) = _resolveActionPeriodRange(block.timestamp, periodType);
        periodStart = _shiftPeriodStartBack(currentStart, periodType, periodOffset);
        periodEnd = _periodEndFromStart(periodStart, periodType);

        (total, page) = _getAccountTransactionsByRangePagedFull(
            account,
            periodStart,
            periodEnd,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    /**
     * @notice 分页查询周期内 bService 统计（最小原子=小时）
     * @dev 返回窗口总量与当前页总量；actionIds 为当前页命中记录
     */
    function getAccountBServiceStatsByCurrentPeriodOffsetPaged(
        address account,
        uint8 periodType,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (FeeStatsPage memory out) {
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidAccountMode(accountMode), "bad accountMode");

        uint256 currentStart;
        (currentStart, ) = _resolveActionPeriodRange(block.timestamp, periodType);
        out.periodStart = _shiftPeriodStartBack(currentStart, periodType, periodOffset);
        out.periodEnd = _periodEndFromStart(out.periodStart, periodType);

        (
            out.total,
            out.windowBServiceUnits6,
            out.windowBServiceUSDC6,
            out.pageBServiceUnits6,
            out.pageBServiceUSDC6,
            out.actionIds
        ) = _getAccountBServiceStatsByRangePaged(
            account,
            out.periodStart,
            out.periodEnd,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    function getAccountBServiceStatsByHourOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_HOUR,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    function getAccountBServiceStatsByDayOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_DAY,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    function getAccountBServiceStatsByWeekOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_WEEK,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    function getAccountBServiceStatsByMonthOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_MONTH,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    function getAccountBServiceStatsByQuarterOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_QUARTER,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    function getAccountBServiceStatsByYearOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_YEAR,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    /**
     * @notice 按 asset + 周期偏移查询（可选按 account 与 EOA/AA 过滤）
     * @param asset route item 里的资产地址（例如 BeamioUserCard 合约地址）
     * @param account 账户地址；传 address(0) 表示不过滤账户
     */
    function getAssetTransactionsByCurrentPeriodOffsetAndAccountModePaged(
        address asset,
        address account,
        uint8 periodType,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        require(asset != address(0), "asset=0");
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidAccountMode(accountMode), "bad accountMode");

        uint256 currentStart;
        (currentStart, ) = _resolveActionPeriodRange(block.timestamp, periodType);
        periodStart = _shiftPeriodStartBack(currentStart, periodType, periodOffset);
        periodEnd = _periodEndFromStart(periodStart, periodType);

        (total, page) = _getAssetTransactionsByRangePaged(
            asset,
            account,
            periodStart,
            periodEnd,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    function getAssetTransactionsByCurrentPeriodOffsetAndAccountModePagedFull(
        address asset,
        address account,
        uint8 periodType,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, TransactionFull[] memory page)
    {
        require(asset != address(0), "asset=0");
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidAccountMode(accountMode), "bad accountMode");

        uint256 currentStart;
        (currentStart, ) = _resolveActionPeriodRange(block.timestamp, periodType);
        periodStart = _shiftPeriodStartBack(currentStart, periodType, periodOffset);
        periodEnd = _periodEndFromStart(periodStart, periodType);

        (total, page) = _getAssetTransactionsByRangePagedFull(
            asset,
            account,
            periodStart,
            periodEnd,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    /**
     * @notice BeamioUserCard 便捷接口（周期=小时）
     */
    function getBeamioUserCardTransactionsByHourOffsetAndAccountModePaged(
        address beamioUserCard,
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAssetTransactionsByCurrentPeriodOffsetAndAccountModePaged(
            beamioUserCard,
            account,
            PERIOD_HOUR,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    /**
     * @notice BeamioUserCard 便捷接口（周期=日）
     */
    function getBeamioUserCardTransactionsByDayOffsetAndAccountModePaged(
        address beamioUserCard,
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAssetTransactionsByCurrentPeriodOffsetAndAccountModePaged(
            beamioUserCard,
            account,
            PERIOD_DAY,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    /**
     * @notice BeamioUserCard 便捷接口（周期=周）
     */
    function getBeamioUserCardTransactionsByWeekOffsetAndAccountModePaged(
        address beamioUserCard,
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAssetTransactionsByCurrentPeriodOffsetAndAccountModePaged(
            beamioUserCard,
            account,
            PERIOD_WEEK,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    /**
     * @notice BeamioUserCard 便捷接口（周期=月）
     */
    function getBeamioUserCardTransactionsByMonthOffsetAndAccountModePaged(
        address beamioUserCard,
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAssetTransactionsByCurrentPeriodOffsetAndAccountModePaged(
            beamioUserCard,
            account,
            PERIOD_MONTH,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    /**
     * @notice BeamioUserCard 便捷接口（周期=季度）
     */
    function getBeamioUserCardTransactionsByQuarterOffsetAndAccountModePaged(
        address beamioUserCard,
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAssetTransactionsByCurrentPeriodOffsetAndAccountModePaged(
            beamioUserCard,
            account,
            PERIOD_QUARTER,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    /**
     * @notice BeamioUserCard 便捷接口（周期=年）
     */
    function getBeamioUserCardTransactionsByYearOffsetAndAccountModePaged(
        address beamioUserCard,
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAssetTransactionsByCurrentPeriodOffsetAndAccountModePaged(
            beamioUserCard,
            account,
            PERIOD_YEAR,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    /**
     * @notice 仅统计：按 BeamioUserCard + 周期偏移（不指定 account）
     * @dev accountMode: 0=全部,1=EOA,2=AA
     */
    function getBeamioUserCardTransactionStatsByCurrentPeriodOffset(
        address beamioUserCard,
        uint8 periodType,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (uint256 total, uint256 periodStart, uint256 periodEnd) {
        require(beamioUserCard != address(0), "card=0");
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidAccountMode(accountMode), "bad accountMode");

        uint256 currentStart;
        (currentStart, ) = _resolveActionPeriodRange(block.timestamp, periodType);
        periodStart = _shiftPeriodStartBack(currentStart, periodType, periodOffset);
        periodEnd = _periodEndFromStart(periodStart, periodType);

        total = _countAssetTransactionsByRange(
            beamioUserCard,
            periodStart,
            periodEnd,
            txCategoryFilter,
            accountMode
        );
    }

    function getBeamioUserCardTransactionStatsByHourOffset(
        address beamioUserCard,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (uint256 total, uint256 periodStart, uint256 periodEnd) {
        return this.getBeamioUserCardTransactionStatsByCurrentPeriodOffset(
            beamioUserCard,
            PERIOD_HOUR,
            periodOffset,
            txCategoryFilter,
            accountMode
        );
    }

    function getBeamioUserCardTransactionStatsByDayOffset(
        address beamioUserCard,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (uint256 total, uint256 periodStart, uint256 periodEnd) {
        return this.getBeamioUserCardTransactionStatsByCurrentPeriodOffset(
            beamioUserCard,
            PERIOD_DAY,
            periodOffset,
            txCategoryFilter,
            accountMode
        );
    }

    function getBeamioUserCardTransactionStatsByWeekOffset(
        address beamioUserCard,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (uint256 total, uint256 periodStart, uint256 periodEnd) {
        return this.getBeamioUserCardTransactionStatsByCurrentPeriodOffset(
            beamioUserCard,
            PERIOD_WEEK,
            periodOffset,
            txCategoryFilter,
            accountMode
        );
    }

    function getBeamioUserCardTransactionStatsByMonthOffset(
        address beamioUserCard,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (uint256 total, uint256 periodStart, uint256 periodEnd) {
        return this.getBeamioUserCardTransactionStatsByCurrentPeriodOffset(
            beamioUserCard,
            PERIOD_MONTH,
            periodOffset,
            txCategoryFilter,
            accountMode
        );
    }

    function getBeamioUserCardTransactionStatsByQuarterOffset(
        address beamioUserCard,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (uint256 total, uint256 periodStart, uint256 periodEnd) {
        return this.getBeamioUserCardTransactionStatsByCurrentPeriodOffset(
            beamioUserCard,
            PERIOD_QUARTER,
            periodOffset,
            txCategoryFilter,
            accountMode
        );
    }

    function getBeamioUserCardTransactionStatsByYearOffset(
        address beamioUserCard,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (uint256 total, uint256 periodStart, uint256 periodEnd) {
        return this.getBeamioUserCardTransactionStatsByCurrentPeriodOffset(
            beamioUserCard,
            PERIOD_YEAR,
            periodOffset,
            txCategoryFilter,
            accountMode
        );
    }

    /**
     * @notice 按 asset + tokenId + 周期偏移查询（可选按 account 与 EOA/AA 过滤）
     */
    function getAssetTokenTransactionsByCurrentPeriodOffsetAndAccountModePaged(
        address asset,
        uint256 tokenId,
        address account,
        uint8 periodType,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        require(asset != address(0), "asset=0");
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidAccountMode(accountMode), "bad accountMode");

        uint256 currentStart;
        (currentStart, ) = _resolveActionPeriodRange(block.timestamp, periodType);
        periodStart = _shiftPeriodStartBack(currentStart, periodType, periodOffset);
        periodEnd = _periodEndFromStart(periodStart, periodType);

        (total, page) = _getAssetTokenTransactionsByRangePaged(
            asset,
            tokenId,
            account,
            periodStart,
            periodEnd,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    function getAssetTokenTransactionsByCurrentPeriodOffsetAndAccountModePagedFull(
        address asset,
        uint256 tokenId,
        address account,
        uint8 periodType,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, TransactionFull[] memory page)
    {
        require(asset != address(0), "asset=0");
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidAccountMode(accountMode), "bad accountMode");

        uint256 currentStart;
        (currentStart, ) = _resolveActionPeriodRange(block.timestamp, periodType);
        periodStart = _shiftPeriodStartBack(currentStart, periodType, periodOffset);
        periodEnd = _periodEndFromStart(periodStart, periodType);

        (total, page) = _getAssetTokenTransactionsByRangePagedFull(
            asset,
            tokenId,
            account,
            periodStart,
            periodEnd,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    /**
     * @notice BeamioUserCard + tokenId 便捷接口（周期=周）
     */
    function getBeamioUserCardTokenTransactionsByWeekOffsetAndAccountModePaged(
        address beamioUserCard,
        uint256 tokenId,
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAssetTokenTransactionsByCurrentPeriodOffsetAndAccountModePaged(
            beamioUserCard,
            tokenId,
            account,
            PERIOD_WEEK,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    // ---- Convenience wrappers: 本/上 hour/day/week/month/quarter/year ----
    function getAccountTransactionsByHourOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAccountTransactionsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_HOUR,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter
        );
    }

    function getAccountTransactionsByDayOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAccountTransactionsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_DAY,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter
        );
    }

    function getAccountTransactionsByWeekOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAccountTransactionsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_WEEK,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter
        );
    }

    /**
     * @notice 周期=周，并支持 EOA/AA 过滤
     * @param accountMode 0=全部,1=EOA,2=AA
     */
    function getAccountTransactionsByWeekOffsetAndAccountModePaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAccountTransactionsByCurrentPeriodOffsetAndAccountModePaged(
            account,
            PERIOD_WEEK,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode
        );
    }

    function getAccountTransactionsByMonthOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAccountTransactionsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_MONTH,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter
        );
    }

    function getAccountTransactionsByQuarterOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAccountTransactionsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_QUARTER,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter
        );
    }

    function getAccountTransactionsByYearOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter
    )
        external
        view
        returns (uint256 total, uint256 periodStart, uint256 periodEnd, LibActionStorage.TransactionRecord[] memory page)
    {
        return this.getAccountTransactionsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_YEAR,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter
        );
    }

    function _copyRoute(LibActionStorage.RouteItem[] storage src)
        internal
        view
        returns (LibActionStorage.RouteItem[] memory dst)
    {
        dst = new LibActionStorage.RouteItem[](src.length);
        for (uint256 i = 0; i < src.length; i++) {
            dst[i] = src[i];
        }
    }

    function _matchByPeriodAndCategory(
        LibActionStorage.TransactionRecord storage txr,
        uint256 periodStart,
        uint256 periodEnd,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) internal view returns (bool) {
        return
            _matchByPeriodAndCategory(
                txr,
                periodStart,
                periodEnd,
                txCategoryFilter,
                accountMode,
                GAS_CHAIN_FILTER_ALL,
                CHAIN_ID_FILTER_ALL
            );
    }

    function _matchByPeriodAndCategory(
        LibActionStorage.TransactionRecord storage txr,
        uint256 periodStart,
        uint256 periodEnd,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    ) internal view returns (bool) {
        if (!txr.exists) return false;
        if (uint256(txr.timestamp) < periodStart || uint256(txr.timestamp) > periodEnd) return false;
        if (txCategoryFilter != bytes32(0) && txr.txCategory != txCategoryFilter) return false;
        if (accountMode == ACCOUNT_MODE_EOA && txr.isAAAccount) return false;
        if (accountMode == ACCOUNT_MODE_AA && !txr.isAAAccount) return false;
        if (gasChainTypeFilter != GAS_CHAIN_FILTER_ALL && txr.fees.gasChainType != gasChainTypeFilter) return false;
        if (chainIdFilter != CHAIN_ID_FILTER_ALL && txr.chainId != chainIdFilter) return false;
        return true;
    }

    function _getAccountTransactionsByRangePaged(
        address account,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) internal view returns (uint256 total, LibActionStorage.TransactionRecord[] memory page) {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        uint256[] storage ids = a.accountActionIds[account];

        for (uint256 i = 0; i < ids.length; i++) {
            if (_matchByPeriodAndCategory(a.txRecordByActionId[ids[i]], periodStart, periodEnd, txCategoryFilter, accountMode)) {
                total++;
            }
        }

        if (pageOffset >= total || pageLimit == 0) {
            return (total, new LibActionStorage.TransactionRecord[](0));
        }

        uint256 end = pageOffset + pageLimit;
        if (end > total) end = total;
        page = new LibActionStorage.TransactionRecord[](end - pageOffset);

        uint256 seen;
        uint256 outIdx;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 actionId = ids[i];
            if (!_matchByPeriodAndCategory(a.txRecordByActionId[actionId], periodStart, periodEnd, txCategoryFilter, accountMode)) {
                continue;
            }
            if (seen >= pageOffset && seen < end) {
                page[outIdx] = a.txRecordByActionId[actionId];
                outIdx++;
            }
            seen++;
            if (seen >= end) break;
        }
    }

    function _getAccountTransactionsByRangePagedFull(
        address account,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) internal view returns (uint256 total, TransactionFull[] memory page) {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        uint256[] storage ids = a.accountActionIds[account];

        for (uint256 i = 0; i < ids.length; i++) {
            if (_matchByPeriodAndCategory(a.txRecordByActionId[ids[i]], periodStart, periodEnd, txCategoryFilter, accountMode)) {
                total++;
            }
        }

        if (pageOffset >= total || pageLimit == 0) {
            return (total, new TransactionFull[](0));
        }

        uint256 end = pageOffset + pageLimit;
        if (end > total) end = total;
        page = new TransactionFull[](end - pageOffset);

        uint256 seen;
        uint256 outIdx;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 actionId = ids[i];
            if (!_matchByPeriodAndCategory(a.txRecordByActionId[actionId], periodStart, periodEnd, txCategoryFilter, accountMode)) {
                continue;
            }
            if (seen >= pageOffset && seen < end) {
                page[outIdx] = _buildFullTransaction(a.txRecordByActionId[actionId], a.routeByActionId[actionId]);
                outIdx++;
            }
            seen++;
            if (seen >= end) break;
        }
    }

    function _getAssetTransactionsByRangePaged(
        address asset,
        address account,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) internal view returns (uint256 total, LibActionStorage.TransactionRecord[] memory page) {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        uint256[] storage ids = a.assetActionIds[asset];

        for (uint256 i = 0; i < ids.length; i++) {
            LibActionStorage.TransactionRecord storage txr = a.txRecordByActionId[ids[i]];
            if (
                _matchByPeriodAndCategory(txr, periodStart, periodEnd, txCategoryFilter, accountMode) &&
                _matchAccount(txr, account)
            ) {
                total++;
            }
        }

        if (pageOffset >= total || pageLimit == 0) {
            return (total, new LibActionStorage.TransactionRecord[](0));
        }

        uint256 end = pageOffset + pageLimit;
        if (end > total) end = total;
        page = new LibActionStorage.TransactionRecord[](end - pageOffset);

        uint256 seen;
        uint256 outIdx;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 actionId = ids[i];
            LibActionStorage.TransactionRecord storage txr2 = a.txRecordByActionId[actionId];
            if (
                !_matchByPeriodAndCategory(txr2, periodStart, periodEnd, txCategoryFilter, accountMode) ||
                !_matchAccount(txr2, account)
            ) {
                continue;
            }
            if (seen >= pageOffset && seen < end) {
                page[outIdx] = txr2;
                outIdx++;
            }
            seen++;
            if (seen >= end) break;
        }
    }

    function _getAssetTransactionsByRangePagedFull(
        address asset,
        address account,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) internal view returns (uint256 total, TransactionFull[] memory page) {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        uint256[] storage ids = a.assetActionIds[asset];

        for (uint256 i = 0; i < ids.length; i++) {
            LibActionStorage.TransactionRecord storage txr = a.txRecordByActionId[ids[i]];
            if (_matchByPeriodAndCategory(txr, periodStart, periodEnd, txCategoryFilter, accountMode) && _matchAccount(txr, account)) {
                total++;
            }
        }

        if (pageOffset >= total || pageLimit == 0) {
            return (total, new TransactionFull[](0));
        }

        uint256 end = pageOffset + pageLimit;
        if (end > total) end = total;
        page = new TransactionFull[](end - pageOffset);

        uint256 seen;
        uint256 outIdx;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 actionId = ids[i];
            LibActionStorage.TransactionRecord storage txr2 = a.txRecordByActionId[actionId];
            if (!_matchByPeriodAndCategory(txr2, periodStart, periodEnd, txCategoryFilter, accountMode) || !_matchAccount(txr2, account)) {
                continue;
            }
            if (seen >= pageOffset && seen < end) {
                page[outIdx] = _buildFullTransaction(txr2, a.routeByActionId[actionId]);
                outIdx++;
            }
            seen++;
            if (seen >= end) break;
        }
    }

    function _getAssetTokenTransactionsByRangePaged(
        address asset,
        uint256 tokenId,
        address account,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) internal view returns (uint256 total, LibActionStorage.TransactionRecord[] memory page) {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        uint256[] storage ids = a.assetTokenActionIds[asset][tokenId];

        for (uint256 i = 0; i < ids.length; i++) {
            LibActionStorage.TransactionRecord storage txr = a.txRecordByActionId[ids[i]];
            if (
                _matchByPeriodAndCategory(txr, periodStart, periodEnd, txCategoryFilter, accountMode) &&
                _matchAccount(txr, account)
            ) {
                total++;
            }
        }

        if (pageOffset >= total || pageLimit == 0) {
            return (total, new LibActionStorage.TransactionRecord[](0));
        }

        uint256 end = pageOffset + pageLimit;
        if (end > total) end = total;
        page = new LibActionStorage.TransactionRecord[](end - pageOffset);

        uint256 seen;
        uint256 outIdx;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 actionId = ids[i];
            LibActionStorage.TransactionRecord storage txr2 = a.txRecordByActionId[actionId];
            if (
                !_matchByPeriodAndCategory(txr2, periodStart, periodEnd, txCategoryFilter, accountMode) ||
                !_matchAccount(txr2, account)
            ) {
                continue;
            }
            if (seen >= pageOffset && seen < end) {
                page[outIdx] = txr2;
                outIdx++;
            }
            seen++;
            if (seen >= end) break;
        }
    }

    function _getAssetTokenTransactionsByRangePagedFull(
        address asset,
        uint256 tokenId,
        address account,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) internal view returns (uint256 total, TransactionFull[] memory page) {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        uint256[] storage ids = a.assetTokenActionIds[asset][tokenId];

        for (uint256 i = 0; i < ids.length; i++) {
            LibActionStorage.TransactionRecord storage txr = a.txRecordByActionId[ids[i]];
            if (_matchByPeriodAndCategory(txr, periodStart, periodEnd, txCategoryFilter, accountMode) && _matchAccount(txr, account)) {
                total++;
            }
        }

        if (pageOffset >= total || pageLimit == 0) {
            return (total, new TransactionFull[](0));
        }

        uint256 end = pageOffset + pageLimit;
        if (end > total) end = total;
        page = new TransactionFull[](end - pageOffset);

        uint256 seen;
        uint256 outIdx;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 actionId = ids[i];
            LibActionStorage.TransactionRecord storage txr2 = a.txRecordByActionId[actionId];
            if (!_matchByPeriodAndCategory(txr2, periodStart, periodEnd, txCategoryFilter, accountMode) || !_matchAccount(txr2, account)) {
                continue;
            }
            if (seen >= pageOffset && seen < end) {
                page[outIdx] = _buildFullTransaction(txr2, a.routeByActionId[actionId]);
                outIdx++;
            }
            seen++;
            if (seen >= end) break;
        }
    }

    function _countAssetTransactionsByRange(
        address asset,
        uint256 periodStart,
        uint256 periodEnd,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) internal view returns (uint256 total) {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        uint256[] storage ids = a.assetActionIds[asset];
        for (uint256 i = 0; i < ids.length; i++) {
            if (
                _matchByPeriodAndCategory(
                    a.txRecordByActionId[ids[i]],
                    periodStart,
                    periodEnd,
                    txCategoryFilter,
                    accountMode
                )
            ) {
                total++;
            }
        }
    }

    function _getAccountBServiceStatsByRangePaged(
        address account,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode
    )
        internal
        view
        returns (
            uint256 total,
            uint256 windowBServiceUnits6,
            uint256 windowBServiceUSDC6,
            uint256 pageBServiceUnits6,
            uint256 pageBServiceUSDC6,
            uint256[] memory actionIds
        )
    {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        uint256[] storage ids = a.accountActionIds[account];

        for (uint256 i = 0; i < ids.length; i++) {
            LibActionStorage.TransactionRecord storage txr = a.txRecordByActionId[ids[i]];
            if (_matchByPeriodAndCategory(txr, periodStart, periodEnd, txCategoryFilter, accountMode)) {
                total++;
                windowBServiceUnits6 += txr.fees.bServiceUnits6;
                windowBServiceUSDC6 += txr.fees.bServiceUSDC6;
            }
        }

        if (pageOffset >= total || pageLimit == 0) {
            return (total, windowBServiceUnits6, windowBServiceUSDC6, 0, 0, new uint256[](0));
        }

        uint256 end = pageOffset + pageLimit;
        if (end > total) end = total;
        actionIds = new uint256[](end - pageOffset);

        uint256 seen;
        uint256 outIdx;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 actionId = ids[i];
            LibActionStorage.TransactionRecord storage txr2 = a.txRecordByActionId[actionId];
            if (!_matchByPeriodAndCategory(txr2, periodStart, periodEnd, txCategoryFilter, accountMode)) {
                continue;
            }
            if (seen >= pageOffset && seen < end) {
                actionIds[outIdx] = actionId;
                outIdx++;
                pageBServiceUnits6 += txr2.fees.bServiceUnits6;
                pageBServiceUSDC6 += txr2.fees.bServiceUSDC6;
            }
            seen++;
            if (seen >= end) break;
        }
    }

    function _matchAccount(LibActionStorage.TransactionRecord storage txr, address account) internal view returns (bool) {
        if (account == address(0)) return true;
        return txr.payer == account || txr.payee == account;
    }

    function _buildFullTransaction(
        LibActionStorage.TransactionRecord storage txr,
        LibActionStorage.RouteItem[] storage routeStore
    ) internal view returns (TransactionFull memory full_) {
        full_.id = txr.id;
        full_.originalPaymentHash = txr.originalPaymentHash;
        full_.chainId = txr.chainId;
        full_.txCategory = txr.txCategory;
        full_.displayJson = txr.displayJson;
        full_.timestamp = txr.timestamp;
        full_.payer = txr.payer;
        full_.payee = txr.payee;
        full_.finalRequestAmountFiat6 = txr.finalRequestAmountFiat6;
        full_.finalRequestAmountUSDC6 = txr.finalRequestAmountUSDC6;
        full_.isAAAccount = txr.isAAAccount;
        full_.route = _copyRoute(routeStore);
        full_.fees = txr.fees;
        full_.meta = txr.meta;
    }

    function _isValidAccountMode(uint8 accountMode) internal pure returns (bool) {
        return accountMode == ACCOUNT_MODE_ALL || accountMode == ACCOUNT_MODE_EOA || accountMode == ACCOUNT_MODE_AA;
    }

    function _isValidGasChainTypeFilter(uint16 gasChainTypeFilter) internal pure returns (bool) {
        return gasChainTypeFilter == GAS_CHAIN_FILTER_ALL || gasChainTypeFilter <= uint16(LibActionStorage.GasChainType.SOLANA);
    }

    function _isValidChainIdFilter(uint256 chainIdFilter) internal pure returns (bool) {
        return chainIdFilter == CHAIN_ID_FILTER_ALL || chainIdFilter > 0;
    }

    function _shiftPeriodStartBack(uint256 startTs, uint8 periodType, uint256 periodOffset) internal pure returns (uint256) {
        if (periodOffset == 0) return startTs;

        if (periodType == PERIOD_HOUR) return startTs - (periodOffset * 1 hours);
        if (periodType == PERIOD_DAY) return startTs - (periodOffset * 1 days);
        if (periodType == PERIOD_WEEK) return startTs - (periodOffset * 7 days);

        uint256 s = startTs;
        for (uint256 i = 0; i < periodOffset; i++) {
            s = _previousPeriodStart(s, periodType);
        }
        return s;
    }

    function _periodEndFromStart(uint256 startTs, uint8 periodType) internal pure returns (uint256) {
        if (periodType == PERIOD_HOUR) return startTs + 1 hours - 1;
        if (periodType == PERIOD_DAY) return startTs + 1 days - 1;
        if (periodType == PERIOD_WEEK) return startTs + 7 days - 1;

        (uint256 year, uint256 month, ) = _daysToDate(startTs / 1 days);
        uint256 nextStart;
        if (periodType == PERIOD_MONTH) {
            (uint256 y, uint256 m) = _addMonths(year, month, 1);
            nextStart = _timestampFromDate(y, m, 1);
            return nextStart - 1;
        }
        if (periodType == PERIOD_QUARTER) {
            (uint256 y2, uint256 m2) = _addMonths(year, month, 3);
            nextStart = _timestampFromDate(y2, m2, 1);
            return nextStart - 1;
        }

        nextStart = _timestampFromDate(year + 1, 1, 1);
        return nextStart - 1;
    }

    function _previousPeriodStart(uint256 currentStart, uint8 periodType) internal pure returns (uint256) {
        if (periodType == PERIOD_HOUR) return currentStart - 1 hours;
        if (periodType == PERIOD_DAY) return currentStart - 1 days;
        if (periodType == PERIOD_WEEK) return currentStart - 7 days;

        (uint256 year, uint256 month, ) = _daysToDate(currentStart / 1 days);
        if (periodType == PERIOD_MONTH) {
            (uint256 y, uint256 m) = _addMonths(year, month, -1);
            return _timestampFromDate(y, m, 1);
        }
        if (periodType == PERIOD_QUARTER) {
            (uint256 y2, uint256 m2) = _addMonths(year, month, -3);
            return _timestampFromDate(y2, m2, 1);
        }

        return _timestampFromDate(year - 1, 1, 1);
    }

    function _isValidActionPeriodType(uint8 periodType) internal pure returns (bool) {
        return
            periodType == PERIOD_HOUR ||
            periodType == PERIOD_DAY ||
            periodType == PERIOD_WEEK ||
            periodType == PERIOD_MONTH ||
            periodType == PERIOD_QUARTER ||
            periodType == PERIOD_YEAR;
    }

    function _resolveActionPeriodRange(uint256 ts, uint8 periodType) internal pure returns (uint256 startTs, uint256 endTs) {
        if (periodType == PERIOD_HOUR) {
            startTs = (ts / 1 hours) * 1 hours;
            endTs = startTs + 1 hours - 1;
            return (startTs, endTs);
        }
        if (periodType == PERIOD_DAY) {
            startTs = (ts / 1 days) * 1 days;
            endTs = startTs + 1 days - 1;
            return (startTs, endTs);
        }

        uint256 daysSinceEpoch = ts / 1 days;
        if (periodType == PERIOD_WEEK) {
            uint256 mondayIndex = (daysSinceEpoch + 3) % 7;
            startTs = (daysSinceEpoch - mondayIndex) * 1 days;
            endTs = startTs + 7 days - 1;
            return (startTs, endTs);
        }

        (uint256 year, uint256 month, ) = _daysToDate(daysSinceEpoch);
        if (periodType == PERIOD_MONTH) {
            startTs = _timestampFromDate(year, month, 1);
            (uint256 y1, uint256 m1) = _addMonths(year, month, 1);
            endTs = _timestampFromDate(y1, m1, 1) - 1;
            return (startTs, endTs);
        }
        if (periodType == PERIOD_QUARTER) {
            uint256 quarterStartMonth = ((month - 1) / 3) * 3 + 1;
            startTs = _timestampFromDate(year, quarterStartMonth, 1);
            (uint256 y2, uint256 m2) = _addMonths(year, quarterStartMonth, 3);
            endTs = _timestampFromDate(y2, m2, 1) - 1;
            return (startTs, endTs);
        }

        startTs = _timestampFromDate(year, 1, 1);
        endTs = _timestampFromDate(year + 1, 1, 1) - 1;
    }

    function _timestampFromDate(uint256 year, uint256 month, uint256 day) internal pure returns (uint256) {
        return _daysFromDate(year, month, day) * 1 days;
    }

    function _addMonths(uint256 year, uint256 month, int256 offset) internal pure returns (uint256 ny, uint256 nm) {
        int256 ym = int256(year) * 12 + int256(month) - 1 + offset;
        require(ym >= 0, "date underflow");
        ny = uint256(ym / 12);
        nm = uint256(ym % 12) + 1;
    }

    function _daysFromDate(uint256 year, uint256 month, uint256 day) internal pure returns (uint256 _days) {
        require(year >= 1970, "year<1970");
        int256 _year = int256(year);
        int256 _month = int256(month);
        int256 _day = int256(day);
        int256 __days = _day
            - 32075
            + (1461 * (_year + 4800 + (_month - 14) / 12)) / 4
            + (367 * (_month - 2 - ((_month - 14) / 12) * 12)) / 12
            - (3 * ((_year + 4900 + (_month - 14) / 12) / 100)) / 4
            - 2440588;
        _days = uint256(__days);
    }

    function _daysToDate(uint256 _days) internal pure returns (uint256 year, uint256 month, uint256 day) {
        int256 __days = int256(_days);
        int256 L = __days + 68569 + 2440588;
        int256 N = (4 * L) / 146097;
        L = L - (146097 * N + 3) / 4;
        int256 _year = (4000 * (L + 1)) / 1461001;
        L = L - (1461 * _year) / 4 + 31;
        int256 _month = (80 * L) / 2447;
        int256 _day = L - (2447 * _month) / 80;
        L = _month / 11;
        _month = _month + 2 - 12 * L;
        _year = 100 * (N - 49) + _year + L;
        year = uint256(_year);
        month = uint256(_month);
        day = uint256(_day);
    }

    function _requireActionExists(uint256 actionId) internal view {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        require(actionId < a.txCount, "invalid actionId");
        require(a.txRecordByActionId[actionId].exists, "tx not found");
    }
}
