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
 * @notice Helper: currency(6dec) / unitPointPrice(currency E18) -> USDC(6dec)
 * @dev
 *  - Errors are unified in Errors.sol:
 *      - BM_ZeroAddress()
 *      - QH_OracleError()
 *  - setOracle is restricted to owner to prevent oracle hijack.
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

    /// @notice currency(6dec) -> usdc6
    function quoteCurrencyAmountInUSDC6(uint8 cur, uint256 amount6) external view returns (uint256) {
        if (amount6 == 0) return 0;

        uint256 cUSD = oracle.getRate(cur);
        uint256 uUSD = oracle.getRate(uint8(BeamioCurrency.USDC));
        if (cUSD == 0 || uUSD == 0) revert QH_OracleError();

        // usdE18 = amount6 * cUSD / 1e6
        uint256 usdE18 = Math.mulDiv(amount6, cUSD, 1e6);

        // usdc6 = (usdE18 * 1e18 / uUSD + 5e11) / 1e12 (round to nearest)
        return (Math.mulDiv(usdE18, E18, uUSD) + 5e11) / E12;
    }

    /// @notice unitPointPriceInCurrencyE18 (price per 1e6 points, in currency E18) -> usdc6
    function quoteUnitPointInUSDC6(uint8 cardCurrency, uint256 unitPointPriceInCurrencyE18) external view returns (uint256) {
        if (unitPointPriceInCurrencyE18 == 0) return 0;

        uint256 cUSD = oracle.getRate(cardCurrency);
        uint256 uUSD = oracle.getRate(uint8(BeamioCurrency.USDC));
        if (cUSD == 0 || uUSD == 0) revert QH_OracleError();

        // usdE18 = unitPointPriceInCurrencyE18 * cUSD / 1e18
        uint256 usdE18 = Math.mulDiv(unitPointPriceInCurrencyE18, cUSD, E18);

        // usdc6 = (usdE18 * 1e18 / uUSD + 5e11) / 1e12 (round to nearest)
        return (Math.mulDiv(usdE18, E18, uUSD) + 5e11) / E12;
    }
}
