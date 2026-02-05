// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BeamioUserCard.sol";
import "./BeamioCurrency.sol";
import "./Errors.sol";

/* =========================
   Quote helper
   ========================= */
interface IBeamioQuoteHelper {
    function quoteCurrencyAmountInUSDC6(uint8 cur, uint256 amount6) external view returns (uint256);
    function quoteUnitPointInUSDC6(uint8 cardCurrency, uint256 unitPointPriceInCurrencyE6) external view returns (uint256);
}

/* =========================
   Deployer
   ========================= */
interface IBeamioDeployerV07 {
    function deploy(bytes calldata initCode) external returns (address);
}

/**
 * @title BeamioUserCardFactoryPaymasterV07
 * @notice Factory / Gateway / Paymaster router for BeamioUserCard
 * @dev
 *  - USDC address: injected via constructor (no magic constant)
 *  - defaultRedeemModule: injected & upgradable by owner
 *  - aaFactory: injected & upgradable by owner
 */
contract BeamioUserCardFactoryPaymasterV07 is IBeamioFactoryOracle {
    // ===== immutable chain config =====
    address public immutable USDC_TOKEN;

    // ===== admin =====
    address public owner;
    mapping(address => bool) public isPaymaster;

    // ===== modules / helpers =====
    address public defaultRedeemModule;
    address public quoteHelper;
    address public deployer;

    // AA factory (BeamioAccountFactory)
    address public _aaFactory;

    // ===== id issuance =====
    uint256 public nextFungibleId;
    uint256 public nextNftId;
    mapping(address => mapping(uint256 => bool)) public tokenIdIssued;

    // ===== registry =====
    mapping(address => address[]) private _cardsOfOwner;
    mapping(address => mapping(address => bool)) public isCardOfOwner;
    mapping(address => address) public beamioUserCardOwner;

    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event PaymasterStatusChanged(address indexed account, bool allowed);

    event DefaultRedeemModuleUpdated(address indexed oldM, address indexed newM);
    event QuoteHelperChanged(address indexed oldH, address indexed newH);
    event DeployerChanged(address indexed oldD, address indexed newD);
    event AAFactoryChanged(address indexed oldFactory, address indexed newFactory);

    event CardDeployed(address indexed cardOwner, address indexed card, uint8 currency, uint256 priceE18);
    event CardRegistered(address indexed cardOwner, address indexed card);
    event RedeemExecuted(address indexed card, address indexed user, bytes32 redeemHash);
    event TokenIdIssued(address indexed card, uint256 indexed id, bool isNft);

    modifier onlyOwner() {
        if (msg.sender != owner) revert BM_NotAuthorized();
        _;
    }

    modifier onlyPaymaster() {
        if (!(msg.sender == owner || isPaymaster[msg.sender])) revert BM_NotAuthorized();
        _;
    }

    constructor(
        address usdcToken_,
        address redeemModule_,
        address quoteHelper_,
        address deployer_,
        address aaFactory_,
        address initialOwner
    ) {
        if (
            usdcToken_ == address(0) ||
            redeemModule_ == address(0) ||
            quoteHelper_ == address(0) ||
            deployer_ == address(0) ||
            aaFactory_ == address(0) ||
            initialOwner == address(0)
        ) revert BM_ZeroAddress();

        USDC_TOKEN = usdcToken_;

        owner = initialOwner;
        isPaymaster[initialOwner] = true;

        defaultRedeemModule = redeemModule_;
        quoteHelper = quoteHelper_;
        deployer = deployer_;
        _aaFactory = aaFactory_;

        // no magic numbers: align with BeamioERC1155Logic constants
        nextFungibleId = 1;
        nextNftId = BeamioERC1155Logic.NFT_START_ID;
    }

    // ===== IBeamioFactoryOracle =====
    function USDC() external view returns (address) { return USDC_TOKEN; }
    function aaFactory() external view returns (address) { return _aaFactory; }
    function isTokenIdIssued(address card, uint256 id) external view returns (bool) { return tokenIdIssued[card][id]; }

    function quoteCurrencyAmountInUSDC6(uint8 cur, uint256 amount6) external view returns (uint256) {
        return IBeamioQuoteHelper(quoteHelper).quoteCurrencyAmountInUSDC6(cur, amount6);
    }

    function quoteUnitPointInUSDC6(address card) external view returns (uint256) {
        BeamioUserCard c = BeamioUserCard(card);
        return IBeamioQuoteHelper(quoteHelper).quoteUnitPointInUSDC6(uint8(c.currency()), c.pointsUnitPriceInCurrencyE6());
    }

    // ===== owner->cards view =====
    function cardsOfOwner(address cardOwner) external view returns (address[] memory) {
        return _cardsOfOwner[cardOwner];
    }

    function latestCardOfOwner(address cardOwner) external view returns (address) {
        uint256 n = _cardsOfOwner[cardOwner].length;
        return n == 0 ? address(0) : _cardsOfOwner[cardOwner][n - 1];
    }

    // ===== admin =====
    function setQuoteHelper(address h) external onlyOwner {
        if (h == address(0)) revert BM_ZeroAddress();
        emit QuoteHelperChanged(quoteHelper, h);
        quoteHelper = h;
    }

    function setDeployer(address d) external onlyOwner {
        if (d == address(0)) revert BM_ZeroAddress();
        emit DeployerChanged(deployer, d);
        deployer = d;
    }

    function setRedeemModule(address m) external onlyOwner {
        if (m == address(0)) revert BM_ZeroAddress();
        emit DefaultRedeemModuleUpdated(defaultRedeemModule, m);
        defaultRedeemModule = m;
    }

    function setAAFactory(address f) external onlyOwner {
        if (f == address(0)) revert BM_ZeroAddress();
        emit AAFactoryChanged(_aaFactory, f);
        _aaFactory = f;
    }

    function transferOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert BM_ZeroAddress();
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }

    function changePaymasterStatus(address a, bool ok) external onlyOwner {
        isPaymaster[a] = ok;
        emit PaymasterStatusChanged(a, ok);
    }

    // ===== id issuance =====
    function issueTokenId(address card, bool isNft) external onlyPaymaster returns (uint256 id) {
        if (card == address(0) || card.code.length == 0) revert BM_ZeroAddress();
        if (BeamioUserCard(card).factoryGateway() != address(this)) revert BM_NotAuthorized();

        id = isNft ? nextNftId++ : nextFungibleId++;
        tokenIdIssued[card][id] = true;

        emit TokenIdIssued(card, id, isNft);
    }

    // ==========================================================
    // Deploy with initCode (creationCode + abi.encode(args))
    // ==========================================================
    function createCardCollectionWithInitCode(
        address cardOwner,
        uint8 currency,
        uint256 priceInCurrencyE6,
        bytes calldata initCode
    ) external onlyPaymaster returns (address card) {
        if (cardOwner == address(0)) revert BM_ZeroAddress();
        if (initCode.length == 0) revert BM_DeployFailed();

        card = IBeamioDeployerV07(deployer).deploy(initCode);
        if (card == address(0) || card.code.length == 0) revert BM_DeployFailed();

        // validate
        BeamioUserCard c = BeamioUserCard(card);
        if (c.factoryGateway() != address(this)) revert F_BadDeployedCard();
        if (c.owner() != cardOwner) revert F_BadDeployedCard();
        if (uint8(c.currency()) != currency) revert F_BadDeployedCard();
        if (c.pointsUnitPriceInCurrencyE6() != priceInCurrencyE6) revert F_BadDeployedCard();

        _registerCard(cardOwner, card);
        beamioUserCardOwner[card] = cardOwner;

        emit CardDeployed(cardOwner, card, currency, priceInCurrencyE6);
    }

    function isBeamioUserCard(address card) external view returns (bool) {
        return beamioUserCardOwner[card] != address(0);
    }

    function registerExistingCard(address cardOwner, address card) external onlyPaymaster {
        if (cardOwner == address(0) || card == address(0)) revert BM_ZeroAddress();
        if (isCardOfOwner[cardOwner][card]) revert F_AlreadyRegistered();

        BeamioUserCard c = BeamioUserCard(card);
        if (c.factoryGateway() != address(this)) revert F_BadDeployedCard();
        if (c.owner() != cardOwner) revert F_BadDeployedCard();

        _registerCard(cardOwner, card);
        beamioUserCardOwner[card] = cardOwner;

        emit CardRegistered(cardOwner, card);
    }

    function _registerCard(address cardOwner, address card) internal {
        isCardOfOwner[cardOwner][card] = true;
        _cardsOfOwner[cardOwner].push(card);
    }

    // ==========================================================
    // Paymaster route: consume redeem for user (gas sponsored offchain)
    // ==========================================================
    function redeemForUser(address cardAddr, string calldata code, address userEOA) external onlyPaymaster {
        if (userEOA == address(0)) revert BM_ZeroAddress();
        if (cardAddr == address(0) || cardAddr.code.length == 0) revert BM_ZeroAddress();
        if (BeamioUserCard(cardAddr).factoryGateway() != address(this)) revert BM_NotAuthorized();

        if (bytes(code).length == 0) revert F_InvalidRedeemHash();

        BeamioUserCard(cardAddr).redeemByGateway(code, userEOA);
        emit RedeemExecuted(cardAddr, userEOA, keccak256(bytes(code)));
    }

    function redeemPoolForUser(address cardAddr, string calldata code, address userEOA) external onlyPaymaster {
        if (userEOA == address(0)) revert BM_ZeroAddress();
        if (cardAddr == address(0) || cardAddr.code.length == 0) revert BM_ZeroAddress();
        if (BeamioUserCard(cardAddr).factoryGateway() != address(this)) revert BM_NotAuthorized();

        if (bytes(code).length == 0) revert F_InvalidRedeemHash();

        BeamioUserCard(cardAddr).redeemPoolByGateway(code, userEOA);
        emit RedeemExecuted(cardAddr, userEOA, keccak256(bytes(code)));
    }
}
