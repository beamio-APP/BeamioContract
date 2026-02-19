// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibActionStorage} from "../libraries/LibActionStorage.sol";

contract FeeStatsFacet {
    uint8 internal constant PERIOD_HOUR = 0;
    uint8 internal constant PERIOD_DAY = 1;
    uint8 internal constant PERIOD_WEEK = 2;
    uint8 internal constant PERIOD_MONTH = 3;
    uint8 internal constant PERIOD_QUARTER = 4;
    uint8 internal constant PERIOD_YEAR = 5;

    uint8 internal constant ACCOUNT_MODE_ALL = 0;
    uint8 internal constant ACCOUNT_MODE_EOA = 1;
    uint8 internal constant ACCOUNT_MODE_AA = 2;
    uint16 internal constant GAS_CHAIN_FILTER_ALL = type(uint16).max;
    uint256 internal constant CHAIN_ID_FILTER_ALL = type(uint256).max;

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

    struct GasWeiStats {
        uint256 total;
        uint256 periodStart;
        uint256 periodEnd;
        uint256 totalGasWei;
    }

    function getBServiceTopNByCurrentPeriodOffset(
        uint8 periodType,
        uint256 periodOffset,
        uint256 topN,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    )
        external
        view
        returns (
            uint256 periodStart,
            uint256 periodEnd,
            address[] memory topTxCountAccounts,
            uint256[] memory topTxCounts,
            address[] memory topUnitsAccounts,
            uint256[] memory topUnits6
        )
    {
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidAccountMode(accountMode), "bad accountMode");
        require(_isValidGasChainTypeFilter(gasChainTypeFilter), "bad gasChainType");
        require(_isValidChainIdFilter(chainIdFilter), "bad chainId");
        if (topN == 0) {
            return (0, 0, new address[](0), new uint256[](0), new address[](0), new uint256[](0));
        }

        uint256 currentStart;
        (currentStart, ) = _resolveActionPeriodRange(block.timestamp, periodType);
        periodStart = _shiftPeriodStartBack(currentStart, periodType, periodOffset);
        periodEnd = _periodEndFromStart(periodStart, periodType);

        (
            topTxCountAccounts,
            topTxCounts,
            topUnitsAccounts,
            topUnits6
        ) = _getBServiceTopNByRange(
            periodStart,
            periodEnd,
            topN,
            txCategoryFilter,
            accountMode,
            gasChainTypeFilter,
            chainIdFilter
        );
    }

    function getBServiceTopNByHourOffset(
        uint256 periodOffset,
        uint256 topN,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    )
        external
        view
        returns (
            uint256 periodStart,
            uint256 periodEnd,
            address[] memory topTxCountAccounts,
            uint256[] memory topTxCounts,
            address[] memory topUnitsAccounts,
            uint256[] memory topUnits6
        )
    {
        return this.getBServiceTopNByCurrentPeriodOffset(
            PERIOD_HOUR,
            periodOffset,
            topN,
            txCategoryFilter,
            accountMode,
            gasChainTypeFilter,
            chainIdFilter
        );
    }

    function getBServiceTopNByDayOffset(
        uint256 periodOffset,
        uint256 topN,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    )
        external
        view
        returns (
            uint256 periodStart,
            uint256 periodEnd,
            address[] memory topTxCountAccounts,
            uint256[] memory topTxCounts,
            address[] memory topUnitsAccounts,
            uint256[] memory topUnits6
        )
    {
        return this.getBServiceTopNByCurrentPeriodOffset(
            PERIOD_DAY,
            periodOffset,
            topN,
            txCategoryFilter,
            accountMode,
            gasChainTypeFilter,
            chainIdFilter
        );
    }

    function getBServiceTopNByWeekOffset(
        uint256 periodOffset,
        uint256 topN,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    )
        external
        view
        returns (
            uint256 periodStart,
            uint256 periodEnd,
            address[] memory topTxCountAccounts,
            uint256[] memory topTxCounts,
            address[] memory topUnitsAccounts,
            uint256[] memory topUnits6
        )
    {
        return this.getBServiceTopNByCurrentPeriodOffset(
            PERIOD_WEEK,
            periodOffset,
            topN,
            txCategoryFilter,
            accountMode,
            gasChainTypeFilter,
            chainIdFilter
        );
    }

    function getBServiceTopNByMonthOffset(
        uint256 periodOffset,
        uint256 topN,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    )
        external
        view
        returns (
            uint256 periodStart,
            uint256 periodEnd,
            address[] memory topTxCountAccounts,
            uint256[] memory topTxCounts,
            address[] memory topUnitsAccounts,
            uint256[] memory topUnits6
        )
    {
        return this.getBServiceTopNByCurrentPeriodOffset(
            PERIOD_MONTH,
            periodOffset,
            topN,
            txCategoryFilter,
            accountMode,
            gasChainTypeFilter,
            chainIdFilter
        );
    }

    function getBServiceTopNByQuarterOffset(
        uint256 periodOffset,
        uint256 topN,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    )
        external
        view
        returns (
            uint256 periodStart,
            uint256 periodEnd,
            address[] memory topTxCountAccounts,
            uint256[] memory topTxCounts,
            address[] memory topUnitsAccounts,
            uint256[] memory topUnits6
        )
    {
        return this.getBServiceTopNByCurrentPeriodOffset(
            PERIOD_QUARTER,
            periodOffset,
            topN,
            txCategoryFilter,
            accountMode,
            gasChainTypeFilter,
            chainIdFilter
        );
    }

    function getBServiceTopNByYearOffset(
        uint256 periodOffset,
        uint256 topN,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    )
        external
        view
        returns (
            uint256 periodStart,
            uint256 periodEnd,
            address[] memory topTxCountAccounts,
            uint256[] memory topTxCounts,
            address[] memory topUnitsAccounts,
            uint256[] memory topUnits6
        )
    {
        return this.getBServiceTopNByCurrentPeriodOffset(
            PERIOD_YEAR,
            periodOffset,
            topN,
            txCategoryFilter,
            accountMode,
            gasChainTypeFilter,
            chainIdFilter
        );
    }

    function getAccountBServiceStatsByCurrentPeriodOffsetPaged(
        address account,
        uint8 periodType,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint256 chainIdFilter
    ) external view returns (FeeStatsPage memory out) {
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidAccountMode(accountMode), "bad accountMode");
        require(_isValidChainIdFilter(chainIdFilter), "bad chainId");

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
            accountMode,
            chainIdFilter
        );
    }

    function getGasWeiStatsByGasChainTypeCurrentPeriodOffset(
        uint16 gasChainType,
        uint8 periodType,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (GasWeiStats memory out) {
        require(gasChainType <= uint16(LibActionStorage.GasChainType.SOLANA), "bad gasChainType");
        require(_isValidActionPeriodType(periodType), "bad periodType");
        require(_isValidAccountMode(accountMode), "bad accountMode");

        uint256 currentStart;
        (currentStart, ) = _resolveActionPeriodRange(block.timestamp, periodType);
        out.periodStart = _shiftPeriodStartBack(currentStart, periodType, periodOffset);
        out.periodEnd = _periodEndFromStart(out.periodStart, periodType);
        (out.total, out.totalGasWei) = _getGasWeiStatsByRange(
            gasChainType,
            out.periodStart,
            out.periodEnd,
            txCategoryFilter,
            accountMode
        );
    }

    function getGasWeiStatsByGasChainTypeHourOffset(
        uint16 gasChainType,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (GasWeiStats memory out) {
        return this.getGasWeiStatsByGasChainTypeCurrentPeriodOffset(
            gasChainType,
            PERIOD_HOUR,
            periodOffset,
            txCategoryFilter,
            accountMode
        );
    }

    function getGasWeiStatsByGasChainTypeDayOffset(
        uint16 gasChainType,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (GasWeiStats memory out) {
        return this.getGasWeiStatsByGasChainTypeCurrentPeriodOffset(
            gasChainType,
            PERIOD_DAY,
            periodOffset,
            txCategoryFilter,
            accountMode
        );
    }

    function getGasWeiStatsByGasChainTypeWeekOffset(
        uint16 gasChainType,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (GasWeiStats memory out) {
        return this.getGasWeiStatsByGasChainTypeCurrentPeriodOffset(
            gasChainType,
            PERIOD_WEEK,
            periodOffset,
            txCategoryFilter,
            accountMode
        );
    }

    function getGasWeiStatsByGasChainTypeMonthOffset(
        uint16 gasChainType,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (GasWeiStats memory out) {
        return this.getGasWeiStatsByGasChainTypeCurrentPeriodOffset(
            gasChainType,
            PERIOD_MONTH,
            periodOffset,
            txCategoryFilter,
            accountMode
        );
    }

    function getGasWeiStatsByGasChainTypeQuarterOffset(
        uint16 gasChainType,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (GasWeiStats memory out) {
        return this.getGasWeiStatsByGasChainTypeCurrentPeriodOffset(
            gasChainType,
            PERIOD_QUARTER,
            periodOffset,
            txCategoryFilter,
            accountMode
        );
    }

    function getGasWeiStatsByGasChainTypeYearOffset(
        uint16 gasChainType,
        uint256 periodOffset,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) external view returns (GasWeiStats memory out) {
        return this.getGasWeiStatsByGasChainTypeCurrentPeriodOffset(
            gasChainType,
            PERIOD_YEAR,
            periodOffset,
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
        uint8 accountMode,
        uint256 chainIdFilter
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_HOUR,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode,
            chainIdFilter
        );
    }

    function getAccountBServiceStatsByDayOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint256 chainIdFilter
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_DAY,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode,
            chainIdFilter
        );
    }

    function getAccountBServiceStatsByWeekOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint256 chainIdFilter
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_WEEK,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode,
            chainIdFilter
        );
    }

    function getAccountBServiceStatsByMonthOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint256 chainIdFilter
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_MONTH,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode,
            chainIdFilter
        );
    }

    function getAccountBServiceStatsByQuarterOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint256 chainIdFilter
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_QUARTER,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode,
            chainIdFilter
        );
    }

    function getAccountBServiceStatsByYearOffsetPaged(
        address account,
        uint256 periodOffset,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint256 chainIdFilter
    ) external view returns (FeeStatsPage memory out) {
        return this.getAccountBServiceStatsByCurrentPeriodOffsetPaged(
            account,
            PERIOD_YEAR,
            periodOffset,
            pageOffset,
            pageLimit,
            txCategoryFilter,
            accountMode,
            chainIdFilter
        );
    }

    function _getAccountBServiceStatsByRangePaged(
        address account,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 pageOffset,
        uint256 pageLimit,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint256 chainIdFilter
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
            if (chainIdFilter != CHAIN_ID_FILTER_ALL && txr.chainId != chainIdFilter) continue;
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
            if (chainIdFilter != CHAIN_ID_FILTER_ALL && txr2.chainId != chainIdFilter) continue;
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

    function _getBServiceTopNByRange(
        uint256 periodStart,
        uint256 periodEnd,
        uint256 topN,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    )
        internal
        view
        returns (
            address[] memory topTxCountAccounts,
            uint256[] memory topTxCounts,
            address[] memory topUnitsAccounts,
            uint256[] memory topUnits6
        )
    {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        address[] storage seen = a.bServiceSeenAccounts;

        address[] memory tmpCountAccounts = new address[](topN);
        uint256[] memory tmpCounts = new uint256[](topN);
        uint256 countSize = 0;

        address[] memory tmpUnitsAccounts = new address[](topN);
        uint256[] memory tmpUnits = new uint256[](topN);
        uint256 unitsSize = 0;

        for (uint256 i = 0; i < seen.length; i++) {
            address acct = seen[i];
            (uint256 txCount, uint256 units6) = _getFeePayerBServiceByRange(
                a,
                acct,
                periodStart,
                periodEnd,
                txCategoryFilter,
                accountMode,
                gasChainTypeFilter,
                chainIdFilter
            );

            if (txCount > 0) {
                if (countSize < topN) {
                    tmpCountAccounts[countSize] = acct;
                    tmpCounts[countSize] = txCount;
                    _bubbleUp(tmpCountAccounts, tmpCounts, countSize);
                    countSize++;
                } else if (txCount > tmpCounts[topN - 1]) {
                    tmpCountAccounts[topN - 1] = acct;
                    tmpCounts[topN - 1] = txCount;
                    _bubbleUp(tmpCountAccounts, tmpCounts, topN - 1);
                }
            }

            if (units6 > 0) {
                if (unitsSize < topN) {
                    tmpUnitsAccounts[unitsSize] = acct;
                    tmpUnits[unitsSize] = units6;
                    _bubbleUp(tmpUnitsAccounts, tmpUnits, unitsSize);
                    unitsSize++;
                } else if (units6 > tmpUnits[topN - 1]) {
                    tmpUnitsAccounts[topN - 1] = acct;
                    tmpUnits[topN - 1] = units6;
                    _bubbleUp(tmpUnitsAccounts, tmpUnits, topN - 1);
                }
            }
        }

        topTxCountAccounts = new address[](countSize);
        topTxCounts = new uint256[](countSize);
        for (uint256 j = 0; j < countSize; j++) {
            topTxCountAccounts[j] = tmpCountAccounts[j];
            topTxCounts[j] = tmpCounts[j];
        }

        topUnitsAccounts = new address[](unitsSize);
        topUnits6 = new uint256[](unitsSize);
        for (uint256 k = 0; k < unitsSize; k++) {
            topUnitsAccounts[k] = tmpUnitsAccounts[k];
            topUnits6[k] = tmpUnits[k];
        }
    }

    function _getGasWeiStatsByRange(
        uint16 gasChainType,
        uint256 periodStart,
        uint256 periodEnd,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) internal view returns (uint256 total, uint256 totalGasWei) {
        LibActionStorage.Layout storage a = LibActionStorage.layout();
        for (uint256 i = 0; i < a.txCount; i++) {
            LibActionStorage.TransactionRecord storage txr = a.txRecordByActionId[i];
            if (!_matchByPeriodAndCategory(txr, periodStart, periodEnd, txCategoryFilter, accountMode)) continue;
            if (txr.fees.gasChainType != gasChainType) continue;
            total++;
            totalGasWei += txr.fees.gasWei;
        }
    }

    function _getFeePayerBServiceByRange(
        LibActionStorage.Layout storage a,
        address feePayer,
        uint256 periodStart,
        uint256 periodEnd,
        bytes32 txCategoryFilter,
        uint8 accountMode,
        uint16 gasChainTypeFilter,
        uint256 chainIdFilter
    ) internal view returns (uint256 txCount, uint256 units6) {
        uint256[] storage ids = a.feePayerActionIds[feePayer];
        for (uint256 i = 0; i < ids.length; i++) {
            LibActionStorage.TransactionRecord storage txr = a.txRecordByActionId[ids[i]];
            if (!_matchByPeriodAndCategory(txr, periodStart, periodEnd, txCategoryFilter, accountMode)) continue;
            if (gasChainTypeFilter != GAS_CHAIN_FILTER_ALL && txr.fees.gasChainType != gasChainTypeFilter) continue;
            if (chainIdFilter != CHAIN_ID_FILTER_ALL && txr.chainId != chainIdFilter) continue;
            if (txr.fees.bServiceUnits6 == 0) continue;
            txCount++;
            units6 += txr.fees.bServiceUnits6;
        }
    }

    function _bubbleUp(address[] memory accounts, uint256[] memory values, uint256 idx) internal pure {
        while (idx > 0 && values[idx] > values[idx - 1]) {
            uint256 v = values[idx - 1];
            values[idx - 1] = values[idx];
            values[idx] = v;

            address a = accounts[idx - 1];
            accounts[idx - 1] = accounts[idx];
            accounts[idx] = a;
            idx--;
        }
    }

    function _matchByPeriodAndCategory(
        LibActionStorage.TransactionRecord storage txr,
        uint256 periodStart,
        uint256 periodEnd,
        bytes32 txCategoryFilter,
        uint8 accountMode
    ) internal view returns (bool) {
        if (!txr.exists) return false;
        if (uint256(txr.timestamp) < periodStart || uint256(txr.timestamp) > periodEnd) return false;
        if (txCategoryFilter != bytes32(0) && txr.txCategory != txCategoryFilter) return false;
        if (accountMode == ACCOUNT_MODE_EOA && txr.isAAAccount) return false;
        if (accountMode == ACCOUNT_MODE_AA && !txr.isAAAccount) return false;
        return true;
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

    function _isValidActionPeriodType(uint8 periodType) internal pure returns (bool) {
        return
            periodType == PERIOD_HOUR ||
            periodType == PERIOD_DAY ||
            periodType == PERIOD_WEEK ||
            periodType == PERIOD_MONTH ||
            periodType == PERIOD_QUARTER ||
            periodType == PERIOD_YEAR;
    }

    function _shiftPeriodStartBack(uint256 startTs, uint8 periodType, uint256 periodOffset) internal pure returns (uint256) {
        if (periodOffset == 0) return startTs;
        if (periodType == PERIOD_HOUR) return startTs - (periodOffset * 1 hours);
        if (periodType == PERIOD_DAY) return startTs - (periodOffset * 1 days);
        if (periodType == PERIOD_WEEK) return startTs - (periodOffset * 7 days);
        uint256 s = startTs;
        for (uint256 i = 0; i < periodOffset; i++) s = _previousPeriodStart(s, periodType);
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
}
