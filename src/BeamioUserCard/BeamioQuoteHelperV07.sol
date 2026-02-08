// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BeamioCurrency.sol";
import "./Errors.sol";

import "../contracts/utils/math/Math.sol";
import "../contracts/access/Ownable.sol";

interface IBeamioOracle {
    function getRate(uint8 currency) external view returns (uint256);
}

/**
 * @title BeamioQuoteHelperV07
 * @notice Helper: 任意货币金额 → USDC(6dec)。汇率设计：全部先换算成 USD，再通过 USD↔USDC 汇率得到 USDC（故意设计，非程序错误）。
 * @dev
 *  - 禁止重新部署，仅使用已有链上地址；新环境请配置 EXISTING_QUOTE_HELPER_ADDRESS 引用现有合约。
 *  - Oracle 存的是「每货币 → USD」的汇率 (E18)。先乘 cUSD 得到 USD 等价，再除以 uUSD (USDC 对 USD 的汇率) 得到 USDC。
 *  - Errors: BM_ZeroAddress(), QH_OracleError()
 *  - setOracle 仅 owner，防止预言机被篡改。
 */
contract BeamioQuoteHelperV07 is Ownable {
    uint256 private constant E18 = 1e18;
    uint256 private constant E12 = 1e12;

    IBeamioOracle public oracle;

    constructor(address _oracle, address initialOwner) Ownable(initialOwner) {
        if (_oracle == address(0)) revert BM_ZeroAddress();
        if (initialOwner == address(0)) revert BM_ZeroAddress();
        oracle = IBeamioOracle(_oracle);
    }

    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert BM_ZeroAddress();
        oracle = IBeamioOracle(_oracle);
    }

    /// @notice 货币金额(6dec) → USDC6。设计：先按该货币对 USD 汇率换算成 USD，再按 USDC 对 USD 汇率换算成 USDC。
    function quoteCurrencyAmountInUSDC6(uint8 cur, uint256 amount6) external view returns (uint256) {
        if (amount6 == 0) return 0;

        uint256 cUSD = oracle.getRate(cur);   // 该货币 → USD (E18)
        uint256 uUSD = oracle.getRate(uint8(BeamioCurrency.USDC)); // USDC → USD (E18)
        if (cUSD == 0 || uUSD == 0) revert QH_OracleError();

        // 步骤1: 金额(货币) → USD 等价 (E18)
        uint256 usdE18 = Math.mulDiv(amount6, cUSD, 1e6);
        // 步骤2: USD → USDC (6dec)，四舍五入
        return (Math.mulDiv(usdE18, E18, uUSD) + 5e11) / E12;
    }

    /// @notice 单价(1e6 points 对应多少该货币 E6) → USDC6。设计：该货币先按对 USD 汇率换算成 USD，再按 USDC 对 USD 换算成 USDC。
    function quoteUnitPointInUSDC6(uint8 cardCurrency, uint256 unitPointPriceInCurrencyE6) external view returns (uint256) {
        if (unitPointPriceInCurrencyE6 == 0) return 0;

        uint256 cUSD = oracle.getRate(cardCurrency);
        uint256 uUSD = oracle.getRate(uint8(BeamioCurrency.USDC));
        if (cUSD == 0 || uUSD == 0) revert QH_OracleError();

        // 步骤1: 单价(货币) → USD 等价 (E18)
        uint256 usdE18 = Math.mulDiv(unitPointPriceInCurrencyE6, cUSD, 1e6);
        // 步骤2: USD → USDC (6dec)，四舍五入
        return (Math.mulDiv(usdE18, E18, uUSD) + 5e11) / E12;
    }
}
