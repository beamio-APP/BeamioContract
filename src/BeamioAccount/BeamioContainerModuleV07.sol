// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// BeamioContainerModuleV07.sol
// - Emits ONLY here (ContainerRelayed / Redeem / Pool events)
// - Strict errors
// - Reserves (freeze) enforced for all module-driven spends
// - Open-Relayed rules:
//   - maxAmount == 0 => unlimited, no special asset restriction, still owner open-sign + nonce + deadline
//   - maxAmount > 0:
//       * if items.length == 1 => Case(2): currency ignored; items[0].amount <= maxAmount
//       * else => Case(1): currency effective; token must be USDC; if has1155 => only UserCard + tokenId==0 + USDC only;
//               totalUsdc6 + cardValueUsdc6 <= quoteCurrencyAmountInUSDC6(currencyType,maxAmount)
//
// - USDC deficit top-up (ONLY when maxAmount>0, token==USDC, and there is ERC20 outflow):
//     if account USDC insufficient, pull deficit from owner via transferFrom (requires allowance+balance)

import "./BeamioTypesV07.sol";
import "../contracts/utils/cryptography/ECDSA.sol";
import "../contracts/utils/cryptography/MessageHashUtils.sol";





interface IBeamioAccountFactoryConfigV2 {
	function quoteHelper() external view returns (address);
	function beamioUserCard() external view returns (address);
	function USDC() external view returns (address);
}

interface IBeamioQuoteHelperV07Like {
	function quoteCurrencyAmountInUSDC6(uint8 cur, uint256 amount6) external view returns (uint256);
	function quoteUnitPointInUSDC6(uint8 cardCurrency, uint256 unitPointPriceInCurrencyE18) external view returns (uint256);
}

interface IBeamioUserCardLike {
	function currency() external view returns (uint8);
	function pointsUnitPriceInCurrencyE18() external view returns (uint256);
}

// ===== MUST match Account client struct layout =====
enum AssetKind { ERC20, ERC1155 }
struct ContainerItem {
	AssetKind kind;
	address asset;
	uint256 amount;
	uint256 tokenId;
	bytes data;
}

library BeamioContainerStorageV07 {
	bytes32 internal constant SLOT = keccak256("beamio.container.module.storage.v07");

	struct Redeem {
		bool active;
		bool used;
		uint64 expiry;      // 0 => never
		address presetTo;   // optional preset recipient (can be 0)
		bytes32 itemsHash;
		bytes itemsData;    // abi.encode(ContainerItem[])
	}

	struct Pool {
		bool active;
		uint64 expiry;      // 0 => never
		uint32 remaining;
		bytes32 itemsHash;
		bytes itemsData;    // abi.encode(ContainerItem[])
	}

	struct Layout {
		uint256 relayedNonce;
		uint256 openRelayedNonce;

		mapping(address => uint256) reservedErc20; // token => reserved
		mapping(address => mapping(uint256 => uint256)) reserved1155; // token => id => reserved

		mapping(bytes32 => Redeem) redeems; // passwordHash => Redeem
		mapping(bytes32 => Pool) pools;     // passwordHash => Pool
		mapping(bytes32 => mapping(address => bool)) poolClaimed; // passwordHash => claimer => claimed
	}

	function layout() internal pure returns (Layout storage l) {
		bytes32 slot = SLOT;
		assembly { l.slot := slot }
	}
}

contract BeamioContainerModuleV07 {
	using ECDSA for bytes32;
	using MessageHashUtils for bytes32;

	// ========= Events (ONLY here) =========
	event ContainerRelayed(address indexed to, bytes32 indexed itemsHash, uint256 nonce, uint256 deadline);

	event RedeemCreated(bytes32 indexed passwordHash, bytes32 indexed itemsHash, uint64 expiry, address presetTo);
	event RedeemCancelled(bytes32 indexed passwordHash);
	event Redeemed(bytes32 indexed passwordHash, address indexed to);

	event FaucetPoolCreated(bytes32 indexed passwordHash, bytes32 indexed itemsHash, uint32 totalCount, uint64 expiry);
	event FaucetPoolCancelled(bytes32 indexed passwordHash);
	event FaucetClaimed(bytes32 indexed passwordHash, address indexed claimer, address indexed to, uint32 remaining);

	// ========= Errors (precise) =========
	error CM_ToZero();
	error CM_TokenZero();
	error CM_Expired(uint256 nowTs, uint256 deadline);
	error CM_BadNonce(uint256 got, uint256 expected);
	error CM_BadSigLen(uint256 got);
	error CM_SignerNotOwner(address signer, address owner);

	error CM_EmptyItems();
	error CM_ItemAssetZero(uint256 i);
	error CM_UnsupportedKind(uint256 i);
	error CM_ERC20HasTokenIdOrData(uint256 i);
	error CM_ERC20AssetNotToken(uint256 i, address asset, address token);
	error CM_ERC1155TokenIdNotZero(uint256 i, uint256 tokenId);

	error CM_MaxAmountForbiddenValue();
	error CM_Case2MustBeSingleItem(uint256 n);
	error CM_Case2AmountExceedsMax(uint256 amount, uint256 maxAmount);

	error CM_NoFactory();
	error CM_NoQuoteHelper();
	error CM_NoUSDC();
	error CM_TokenNotUSDC(address token, address usdc);
	error CM_NoUserCard();
	error CM_ERC1155NotUserCard(uint256 i, address token, address userCard);

	error CM_UnitPriceZero();
	error CM_ExceedsMax(uint256 totalUsdc6, uint256 maxUsdc6);

	error CM_ReservedERC20Violation(address token, uint256 spend, uint256 bal, uint256 reserved);
	error CM_Reserved1155Violation(address token, uint256 id, uint256 spend, uint256 bal, uint256 reserved);

	error CM_ERC20TransferFailed(address token, address to, uint256 amount);
	error CM_ERC20TransferFromFailed(address token, address from, address to, uint256 amount);
	error CM_ERC1155TransferFailed(address token, address to);

	error CM_OwnerAllowanceInsufficient(uint256 need, uint256 allowance);
	error CM_OwnerBalanceInsufficient(uint256 need, uint256 balance);

	error RD_ZeroPasswordHash();
	error RD_AlreadyExists(bytes32 passwordHash);
	error RD_NotFound(bytes32 passwordHash);
	error RD_AlreadyUsed(bytes32 passwordHash);
	error RD_Expired(bytes32 passwordHash);
	error RD_BadPassword();

	error FP_ZeroPasswordHash();
	error FP_InvalidTotalCount();
	error FP_AlreadyExists(bytes32 passwordHash);
	error FP_NotFound(bytes32 passwordHash);
	error FP_Expired(bytes32 passwordHash);
	error FP_OutOfStock(bytes32 passwordHash);
	error FP_AlreadyClaimed(bytes32 passwordHash, address claimer);
	error FP_ItemsMismatch();

	// ========= EIP-712 =========
	bytes32 private constant DOMAIN_TYPEHASH =
		keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
	bytes32 private constant NAME_HASH = keccak256(bytes("BeamioAccount"));
	bytes32 private constant VERSION_HASH = keccak256(bytes("1"));

	bytes32 private constant CONTAINER_TYPEHASH =
		keccak256("ContainerMain(address account,address to,bytes32 itemsHash,uint256 nonce,uint256 deadline)");

	// Open: NOT binding "to"
	bytes32 private constant OPEN_CONTAINER_TYPEHASH =
		keccak256("OpenContainerMain(address account,address token,bytes32 itemsHash,uint8 currencyType,uint256 maxAmount,uint256 nonce,uint256 deadline)");

	// ========= Context helpers (delegatecall or staticcall facade) =========
	function _ctxAccount() internal view returns (address acct) {
		// normal path: delegatecall => address(this) is account
		// view facade path (staticcall): last 20 bytes is account address
		if (msg.sender == address(this)) {
			return address(this);
		}

		// If called by Account.staticDelegate facade: calldata ends with account address
		if (msg.sig == this.simulateOpenContainer.selector || msg.sig == this.relayedNonce.selector || msg.sig == this.openRelayedNonce.selector) {
			if (msg.data.length >= 20) {
				address a;
				assembly {
					a := shr(96, calldataload(sub(calldatasize(), 20)))
				}
				return a;
			}
		}

		// fallback: treat as direct (not expected)
		return address(this);
	}

	function _onlyFactory(address acct) internal view {
		// factory stored in BeamioAccount at slot layout (public var), we read via interface-less slot is hard.
		// We rely on the Account wrapper to enforce onlyFactory, so module does NOT repeat it.
		acct;
	}

	function _owner(address acct) internal view returns (address o) {
		// owner is first declared var in BeamioAccount; we read it via extcall-free assembly is fragile.
		// Safer: call owner() via staticcall to acct itself (cheap in eth_call; ok in tx too).
		(bool ok, bytes memory ret) = acct.staticcall(abi.encodeWithSignature("owner()"));
		if (!ok || ret.length != 32) revert NotAuthorized();
		return abi.decode(ret, (address));
	}

	function _factory(address acct) internal view returns (address f) {
		(bool ok, bytes memory ret) = acct.staticcall(abi.encodeWithSignature("factory()"));
		if (!ok || ret.length != 32) revert CM_NoFactory();
		return abi.decode(ret, (address));
	}

	function domainSeparator(address acct) public view returns (bytes32) {
		return keccak256(
			abi.encode(
				DOMAIN_TYPEHASH,
				NAME_HASH,
				VERSION_HASH,
				block.chainid,
				acct
			)
		);
	}

	// ========= Hashing =========
	function hashItem(ContainerItem calldata it) public pure returns (bytes32) {
		return keccak256(
			abi.encode(
				uint8(it.kind),
				it.asset,
				it.amount,
				it.tokenId,
				keccak256(it.data)
			)
		);
	}

	function hashItems(ContainerItem[] calldata items) public pure returns (bytes32 itemsHash) {
		uint256 n = items.length;
		bytes32[] memory hs = new bytes32[](n);
		for (uint256 i = 0; i < n; i++) {
			hs[i] = hashItem(items[i]);
		}
		return keccak256(abi.encode(hs));
	}

	function _hashContainerMessage(address acct, address to, bytes32 itemsHash_, uint256 nonce_, uint256 deadline_) internal view returns (bytes32) {
		bytes32 structHash = keccak256(
			abi.encode(CONTAINER_TYPEHASH, acct, to, itemsHash_, nonce_, deadline_)
		);
		return keccak256(abi.encodePacked("\x19\x01", domainSeparator(acct), structHash));
	}

	function _hashOpenContainerMessage(
		address acct,
		address token,
		bytes32 itemsHash_,
		uint8 currencyType,
		uint256 maxAmount,
		uint256 nonce_,
		uint256 deadline_
	) internal view returns (bytes32) {
		bytes32 structHash = keccak256(
			abi.encode(OPEN_CONTAINER_TYPEHASH, acct, token, itemsHash_, currencyType, maxAmount, nonce_, deadline_)
		);
		return keccak256(abi.encodePacked("\x19\x01", domainSeparator(acct), structHash));
	}

	// ========= Views (nonce) =========
	function relayedNonce() external view returns (uint256) {
		address acct = _ctxAccount();
		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();
		acct;
		return l.relayedNonce;
	}

	function openRelayedNonce() external view returns (uint256) {
		address acct = _ctxAccount();
		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();
		acct;
		return l.openRelayedNonce;
	}

	// ========= Reserved accounting =========
	function _reserveAdd(ContainerItem[] memory items) internal {
		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();

		for (uint256 i = 0; i < items.length; i++) {
			ContainerItem memory it = items[i];
			if (it.amount == 0) continue;

			if (it.kind == AssetKind.ERC20) {
				l.reservedErc20[it.asset] += it.amount;
			} else if (it.kind == AssetKind.ERC1155) {
				l.reserved1155[it.asset][it.tokenId] += it.amount;
			} else {
				// should never
				revert Unsupported();
			}
		}
	}

	function _reserveSub(ContainerItem[] memory items) internal {
		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();

		for (uint256 i = 0; i < items.length; i++) {
			ContainerItem memory it = items[i];
			if (it.amount == 0) continue;

			if (it.kind == AssetKind.ERC20) {
				l.reservedErc20[it.asset] -= it.amount;
			} else if (it.kind == AssetKind.ERC1155) {
				l.reserved1155[it.asset][it.tokenId] -= it.amount;
			} else {
				revert Unsupported();
			}
		}
	}

	function _checkSpendable(address acct, ContainerItem[] calldata items) internal view {
		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();

		for (uint256 i = 0; i < items.length; i++) {
			ContainerItem calldata it = items[i];
			if (it.amount == 0) continue;

			if (it.kind == AssetKind.ERC20) {
				uint256 bal = IERC20Like(it.asset).balanceOf(acct);
				uint256 r = l.reservedErc20[it.asset];
				if (bal < it.amount) revert CM_ReservedERC20Violation(it.asset, it.amount, bal, r);
				if (bal - it.amount < r) revert CM_ReservedERC20Violation(it.asset, it.amount, bal, r);
			} else if (it.kind == AssetKind.ERC1155) {
				// ERC1155 balanceOf is not in the minimal interface; do the safe route: attempt transfers will fail anyway.
				// We enforce reserve consistency by checking reserved only (cannot prove balance without IERC1155.balanceOf).
				uint256 r2 = l.reserved1155[it.asset][it.tokenId];
				// no exact bal check here; rely on transfer revert, but still ensure not spending into reserved:
				// (best-effort) require r2 == 0 OR caller is redeem/pool consuming reserved (they subtract before spend).
				// For generic spends, enforce r2==0.
				if (r2 != 0) revert CM_Reserved1155Violation(it.asset, it.tokenId, it.amount, 0, r2);
			} else {
				revert Unsupported();
			}
		}
	}

	// ========= Internal transfer pipeline =========
	function _containerERC20(address to, ContainerItem[] memory items20) internal {
		for (uint256 i = 0; i < items20.length; i++) {
			ContainerItem memory it = items20[i];
			if (it.amount == 0) continue;

			bool ok = IERC20Like(it.asset).transfer(to, it.amount);
			if (!ok) revert CM_ERC20TransferFailed(it.asset, to, it.amount);
		}
	}

	function _containerERC1155_token(
		address token,
		address to,
		uint256[] memory ids,
		uint256[] memory amounts,
		bytes[] memory datas
	) internal {
		uint256 n = ids.length;
		if (n == 0) return;
		if (n != amounts.length || n != datas.length) revert LenMismatch();

		bool sameData = true;
		bytes32 d0 = keccak256(datas[0]);
		for (uint256 i = 1; i < n; i++) {
			if (keccak256(datas[i]) != d0) { sameData = false; break; }
		}

		if (sameData) {
			try IERC1155Like(token).safeBatchTransferFrom(address(this), to, ids, amounts, datas[0]) {
				return;
			} catch {
				// fallback to singles
			}
		}

		for (uint256 i = 0; i < n; i++) {
			if (amounts[i] == 0) continue;
			try IERC1155Like(token).safeTransferFrom(address(this), to, ids[i], amounts[i], datas[i]) {
			} catch {
				revert CM_ERC1155TransferFailed(token, to);
			}
		}
	}

	function _containerERC1155(address to, ContainerItem[] memory items1155) internal {
		uint256 n = items1155.length;
		if (n == 0) return;

		// group by token
		address[] memory tokens = new address[](n);
		uint256 tLen = 0;

		// temp counters in memory maps are hard; do O(n^2) small-n approach (practical for container)
		for (uint256 i = 0; i < n; i++) {
			address token = items1155[i].asset;
			bool seen = false;
			for (uint256 j = 0; j < tLen; j++) {
				if (tokens[j] == token) { seen = true; break; }
			}
			if (!seen) tokens[tLen++] = token;
		}

		for (uint256 ti = 0; ti < tLen; ti++) {
			address token = tokens[ti];

			// count entries
			uint256 m = 0;
			for (uint256 i = 0; i < n; i++) {
				if (items1155[i].asset == token) m++;
			}

			uint256[] memory ids = new uint256[](m);
			uint256[] memory amts = new uint256[](m);
			bytes[] memory datas = new bytes[](m);

			uint256 p = 0;
			for (uint256 i = 0; i < n; i++) {
				if (items1155[i].asset != token) continue;
				ids[p] = items1155[i].tokenId;
				amts[p] = items1155[i].amount;
				datas[p] = items1155[i].data;
				p++;
			}

			_containerERC1155_token(token, to, ids, amts, datas);
		}
	}

	function _containerMain(address to, ContainerItem[] calldata items) internal {
		ContainerItem[] memory m = new ContainerItem[](items.length);
		for (uint256 i = 0; i < items.length; i++) {
			m[i] = items[i];
		}
		_containerMainMem(to, m);
	}

	// =========================================================
	// (A) to-bound owner relayed container (nonce in module layout)
	// =========================================================
	function containerMainRelayed(
		address to,
		ContainerItem[] calldata items,
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external {
		address acct = address(this);
		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();

		if (block.timestamp > deadline_) revert CM_Expired(block.timestamp, deadline_);
		if (nonce_ != l.relayedNonce) revert CM_BadNonce(nonce_, l.relayedNonce);
		if (sig.length != 65) revert CM_BadSigLen(sig.length);

		bytes32 itemsHash_ = hashItems(items);
		bytes32 digest = _hashContainerMessage(acct, to, itemsHash_, nonce_, deadline_);
		address signer = ECDSA.recover(digest, sig);
		address o = _owner(acct);
		if (signer != o) revert CM_SignerNotOwner(signer, o);

		// reserve check: cannot spend frozen assets
		_checkSpendable(acct, items);

		l.relayedNonce = nonce_ + 1;

		_containerMain(to, items);

		emit ContainerRelayed(to, itemsHash_, nonce_, deadline_);
	}

	// =========================================================
	// (B) open relayed (no-to signature) + strict max rules
	// =========================================================
	function containerMainRelayedOpen(
		address to,
		ContainerItem[] calldata items,
		address token,
		uint8 currencyType,
		uint256 maxAmount,   // 0 => unlimited
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external {
		address acct = address(this);
		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();

		if (to == address(0)) revert CM_ToZero();
		if (token == address(0)) revert CM_TokenZero();
		if (block.timestamp > deadline_) revert CM_Expired(block.timestamp, deadline_);
		if (nonce_ != l.openRelayedNonce) revert CM_BadNonce(nonce_, l.openRelayedNonce);
		if (sig.length != 65) revert CM_BadSigLen(sig.length);

		uint256 n = items.length;
		if (n == 0) revert CM_EmptyItems();

		bool has1155 = false;
		uint256 totalErc20 = 0;        // raw ERC20 amount (must be USDC6 in Case(1))
		uint256 cardId0Amount6 = 0;    // points6 (ERC1155 id0 amount)

		for (uint256 i = 0; i < n; i++) {
			ContainerItem calldata it = items[i];
			if (it.asset == address(0)) revert CM_ItemAssetZero(i);

			if (it.kind == AssetKind.ERC20) {
				if (it.asset != token) revert CM_ERC20AssetNotToken(i, it.asset, token);
				if (it.tokenId != 0 || it.data.length != 0) revert CM_ERC20HasTokenIdOrData(i);
				totalErc20 += it.amount;
				continue;
			}

			if (it.kind == AssetKind.ERC1155) {
				has1155 = true;
				if (it.tokenId != 0) revert CM_ERC1155TokenIdNotZero(i, it.tokenId);
				cardId0Amount6 += it.amount;
				continue;
			}

			revert CM_UnsupportedKind(i);
		}

		// reserve check (cannot spend frozen assets)
		_checkSpendable(acct, items);

		// =========================
		// Max rules
		// =========================
		if (maxAmount > 0) {
			// Case(2): single item => currency ignored; amount <= maxAmount
			if (n == 1) {
				if (items[0].amount > maxAmount) revert CM_Case2AmountExceedsMax(items[0].amount, maxAmount);
			} else {
				// Case(1): currency effective
				address f = _factory(acct);
				address helperAddr = IBeamioAccountFactoryConfigV2(f).quoteHelper();
				address usdc = IBeamioAccountFactoryConfigV2(f).USDC();
				address userCard = IBeamioAccountFactoryConfigV2(f).beamioUserCard();

				if (helperAddr == address(0) || helperAddr.code.length == 0) revert CM_NoQuoteHelper();
				if (usdc == address(0)) revert CM_NoUSDC();

				if (token != usdc) revert CM_TokenNotUSDC(token, usdc);

				// If has1155 => must be userCard
				if (has1155) {
					if (userCard == address(0) || userCard.code.length == 0) revert CM_NoUserCard();
					for (uint256 i = 0; i < n; i++) {
						if (items[i].kind == AssetKind.ERC1155 && items[i].asset != userCard) {
							revert CM_ERC1155NotUserCard(i, items[i].asset, userCard);
						}
					}
				}

				IBeamioQuoteHelperV07Like qh = IBeamioQuoteHelperV07Like(helperAddr);
				uint256 maxUsdc6 = qh.quoteCurrencyAmountInUSDC6(currencyType, maxAmount);

				uint256 cardValueUsdc6 = 0;
				if (has1155 && cardId0Amount6 > 0) {
					uint8 cardCur = IBeamioUserCardLike(userCard).currency();
					uint256 unitPriceE18 = IBeamioUserCardLike(userCard).pointsUnitPriceInCurrencyE18();
					if (unitPriceE18 == 0) revert CM_UnitPriceZero();

					uint256 unitPointUsdc6 = qh.quoteUnitPointInUSDC6(cardCur, unitPriceE18);
					cardValueUsdc6 = (cardId0Amount6 * unitPointUsdc6) / 1e6;
				}

				if (totalErc20 + cardValueUsdc6 > maxUsdc6) {
					revert CM_ExceedsMax(totalErc20 + cardValueUsdc6, maxUsdc6);
				}

				// ===== owner top-up if account USDC insufficient (only when token==USDC and erc20 outflow exists) =====
				if (totalErc20 > 0) {
					uint256 balAcct = IERC20Like(usdc).balanceOf(acct);
					if (balAcct < totalErc20) {
						uint256 deficit = totalErc20 - balAcct;

						address o = _owner(acct);
						uint256 allow = IERC20Like(usdc).allowance(o, acct);
						if (allow < deficit) revert CM_OwnerAllowanceInsufficient(deficit, allow);

						uint256 balOwner = IERC20Like(usdc).balanceOf(o);
						if (balOwner < deficit) revert CM_OwnerBalanceInsufficient(deficit, balOwner);

						bool ok = IERC20Like(usdc).transferFrom(o, acct, deficit);
						if (!ok) revert CM_ERC20TransferFromFailed(usdc, o, acct, deficit);
					}
				}
			}
		}

		// =========================
		// Signature check (bind token/items/currency/max/nonce/deadline; NOT bind 'to')
		// =========================
		bytes32 itemsHash_ = hashItems(items);
		bytes32 digest = _hashOpenContainerMessage(acct, token, itemsHash_, currencyType, maxAmount, nonce_, deadline_);
		address signer = ECDSA.recover(digest, sig);
		address o2 = _owner(acct);
		if (signer != o2) revert CM_SignerNotOwner(signer, o2);

		l.openRelayedNonce = nonce_ + 1;

		_containerMain(to, items);

		emit ContainerRelayed(to, itemsHash_, nonce_, deadline_);
	}

	// =========================================================
	// View-only simulation (staticcall facade)
	// =========================================================
	function simulateOpenContainer(
		address to,
		ContainerItem[] calldata items,
		address token,
		uint8 currencyType,
		uint256 maxAmount,
		uint256 nonce_,
		uint256 deadline_,
		bytes calldata sig
	) external view returns (bool ok, string memory reason) {
		address acct = _ctxAccount();
		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();

		if (to == address(0)) return (false, "to=0");
		if (token == address(0)) return (false, "token=0");
		if (block.timestamp > deadline_) return (false, "expired");
		if (nonce_ != l.openRelayedNonce) return (false, "bad nonce");
		if (sig.length != 65) return (false, "bad sig len");
		if (items.length == 0) return (false, "empty items");

		bool has1155 = false;
		uint256 totalErc20 = 0;
		uint256 cardId0Amount6 = 0;

		for (uint256 i = 0; i < items.length; i++) {
			ContainerItem calldata it = items[i];
			if (it.asset == address(0)) return (false, "item asset=0");

			if (it.kind == AssetKind.ERC20) {
				if (it.asset != token) return (false, "erc20 asset!=token");
				if (it.tokenId != 0 || it.data.length != 0) return (false, "erc20 has tokenId/data");
				totalErc20 += it.amount;
				continue;
			}

			if (it.kind == AssetKind.ERC1155) {
				has1155 = true;
				if (it.tokenId != 0) return (false, "erc1155 tokenId!=0");
				cardId0Amount6 += it.amount;
				continue;
			}

			return (false, "unsupported kind");
		}

		if (maxAmount > 0) {
			if (items.length == 1) {
				if (items[0].amount > maxAmount) return (false, "case2: amount>max");
			} else {
				address f = _factory(acct);
				address helperAddr = IBeamioAccountFactoryConfigV2(f).quoteHelper();
				address usdc = IBeamioAccountFactoryConfigV2(f).USDC();
				address userCard = IBeamioAccountFactoryConfigV2(f).beamioUserCard();

				if (helperAddr == address(0) || helperAddr.code.length == 0) return (false, "no helper");
				if (usdc == address(0)) return (false, "no usdc");
				if (token != usdc) return (false, "case1: token!=usdc");

				if (has1155) {
					if (userCard == address(0) || userCard.code.length == 0) return (false, "no usercard");
					for (uint256 i = 0; i < items.length; i++) {
						if (items[i].kind == AssetKind.ERC1155 && items[i].asset != userCard) return (false, "case1: 1155!=usercard");
					}
				}

				IBeamioQuoteHelperV07Like qh = IBeamioQuoteHelperV07Like(helperAddr);
				uint256 maxUsdc6 = qh.quoteCurrencyAmountInUSDC6(currencyType, maxAmount);

				uint256 cardValueUsdc6 = 0;
				if (has1155 && cardId0Amount6 > 0) {
					uint8 cardCur = IBeamioUserCardLike(userCard).currency();
					uint256 unitPriceE18 = IBeamioUserCardLike(userCard).pointsUnitPriceInCurrencyE18();
					if (unitPriceE18 == 0) return (false, "unitPrice=0");
					uint256 unitPointUsdc6 = qh.quoteUnitPointInUSDC6(cardCur, unitPriceE18);
					cardValueUsdc6 = (cardId0Amount6 * unitPointUsdc6) / 1e6;
				}

				if (totalErc20 + cardValueUsdc6 > maxUsdc6) return (false, "case1: exceeds max");

				// owner top-up feasibility
				if (totalErc20 > 0) {
					uint256 balAcct = IERC20Like(usdc).balanceOf(acct);
					if (balAcct < totalErc20) {
						uint256 deficit = totalErc20 - balAcct;

						address o = _owner(acct);
						uint256 allow = IERC20Like(usdc).allowance(o, acct);
						if (allow < deficit) return (false, "owner allowance insufficient");

						uint256 balOwner = IERC20Like(usdc).balanceOf(o);
						if (balOwner < deficit) return (false, "owner balance insufficient");
					}
				}
			}
		}

		bytes32 itemsHash_ = hashItems(items);
		bytes32 digest = _hashOpenContainerMessage(acct, token, itemsHash_, currencyType, maxAmount, nonce_, deadline_);
		address signer = ECDSA.recover(digest, sig);
		address o2 = _owner(acct);
		if (signer != o2) return (false, "sig not owner");

		return (true, "ok");
	}

	// =========================================================
	// Redeem (single-use password) with freeze / cancel
	// =========================================================
	function createRedeem(
		bytes32 passwordHash,
		address to,
		ContainerItem[] calldata items,
		uint64 expiry
	) external {
		address acct = address(this);
		if (passwordHash == bytes32(0)) revert RD_ZeroPasswordHash();

		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();
		BeamioContainerStorageV07.Redeem storage r = l.redeems[passwordHash];
		if (r.active) revert RD_AlreadyExists(passwordHash);

		if (items.length == 0) revert CM_EmptyItems();

		// freeze: reserve needed amounts
		bytes memory enc = abi.encode(items);
		bytes32 ih = hashItems(items);

		// NOTE: we cannot check spendable ERC1155 balance without IERC1155.balanceOf; we only reserve bookkeeping
		ContainerItem[] memory memItems = abi.decode(enc, (ContainerItem[]));
		_reserveAdd(memItems);

		r.active = true;
		r.used = false;
		r.expiry = expiry;
		r.presetTo = to;
		r.itemsHash = ih;
		r.itemsData = enc;

		emit RedeemCreated(passwordHash, ih, expiry, to);
	}

	function cancelRedeem(bytes32 passwordHash) external {
		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();
		BeamioContainerStorageV07.Redeem storage r = l.redeems[passwordHash];
		if (!r.active) revert RD_NotFound(passwordHash);
		if (r.used) revert RD_AlreadyUsed(passwordHash);

		ContainerItem[] memory items = abi.decode(r.itemsData, (ContainerItem[]));
		_reserveSub(items);

		delete l.redeems[passwordHash];

		emit RedeemCancelled(passwordHash);
	}

	function _containerMainMem(address to, ContainerItem[] memory items) internal {
		if (to == address(0)) revert CM_ToZero();
		uint256 n = items.length;
		if (n == 0) revert CM_EmptyItems();

		uint256 n20 = 0;
		uint256 n1155 = 0;

		for (uint256 i = 0; i < n; i++) {
			if (items[i].asset == address(0)) revert CM_ItemAssetZero(i);
			if (items[i].kind == AssetKind.ERC20) n20++;
			else if (items[i].kind == AssetKind.ERC1155) n1155++;
			else revert CM_UnsupportedKind(i);
		}

		if (n20 > 0) {
			ContainerItem[] memory a20 = new ContainerItem[](n20);
			uint256 p = 0;
			for (uint256 i = 0; i < n; i++) {
				if (items[i].kind == AssetKind.ERC20) a20[p++] = items[i];
			}
			_containerERC20(to, a20);
		}

		if (n1155 > 0) {
			ContainerItem[] memory a1155 = new ContainerItem[](n1155);
			uint256 p2 = 0;
			for (uint256 i = 0; i < n; i++) {
				if (items[i].kind == AssetKind.ERC1155) a1155[p2++] = items[i];
			}
			_containerERC1155(to, a1155);
		}
	}

	function redeem(string calldata password, address to) external {
		if (to == address(0)) revert CM_ToZero();
		bytes32 ph = keccak256(bytes(password));
		if (ph == bytes32(0)) revert RD_BadPassword();

		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();
		BeamioContainerStorageV07.Redeem storage r = l.redeems[ph];
		if (!r.active) revert RD_NotFound(ph);
		if (r.used) revert RD_AlreadyUsed(ph);

		if (r.expiry != 0 && block.timestamp > r.expiry) revert RD_Expired(ph);

		// consume reserves, then execute
		ContainerItem[] memory items = abi.decode(r.itemsData, (ContainerItem[]));
		_reserveSub(items);

		r.used = true;
		r.active = false;

		_containerMainMem(to, items);

		delete l.redeems[ph];

		emit Redeemed(ph, to);
	}

	// =========================================================
	// Faucet pool (password may leak; many uses; per-wallet once)
	// - freeze: reserve items * totalCount
	// - redeem must supply items matching template hash
	// =========================================================
	function createFaucetPool(
		bytes32 passwordHash,
		uint32 totalCount,
		uint64 expiry,
		ContainerItem[] calldata items
	) external {
		if (passwordHash == bytes32(0)) revert FP_ZeroPasswordHash();
		if (totalCount == 0) revert FP_InvalidTotalCount();
		if (items.length == 0) revert CM_EmptyItems();

		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();
		BeamioContainerStorageV07.Pool storage p = l.pools[passwordHash];
		if (p.active) revert FP_AlreadyExists(passwordHash);

		bytes memory enc = abi.encode(items);
		bytes32 ih = hashItems(items);

		// reserve (items * totalCount)
		ContainerItem[] memory memItems = abi.decode(enc, (ContainerItem[]));
		for (uint256 i = 0; i < memItems.length; i++) {
			if (memItems[i].amount == 0) continue;
			memItems[i].amount = memItems[i].amount * uint256(totalCount);
		}
		_reserveAdd(memItems);

		p.active = true;
		p.expiry = expiry;
		p.remaining = totalCount;
		p.itemsHash = ih;
		p.itemsData = enc;

		emit FaucetPoolCreated(passwordHash, ih, totalCount, expiry);
	}

	function cancelFaucetPool(bytes32 passwordHash) external {
		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();
		BeamioContainerStorageV07.Pool storage p = l.pools[passwordHash];
		if (!p.active) revert FP_NotFound(passwordHash);

		// release reserves (items * remaining)
		ContainerItem[] memory baseItems = abi.decode(p.itemsData, (ContainerItem[]));
		ContainerItem[] memory scaled = new ContainerItem[](baseItems.length);
		for (uint256 i = 0; i < baseItems.length; i++) {
			scaled[i] = baseItems[i];
			if (scaled[i].amount != 0) {
				scaled[i].amount = scaled[i].amount * uint256(p.remaining);
			}
		}
		_reserveSub(scaled);

		delete l.pools[passwordHash];

		emit FaucetPoolCancelled(passwordHash);
	}

	function faucetRedeemPool(
		string calldata password,
		address claimer,
		address to,
		ContainerItem[] calldata items
	) external {
		if (claimer == address(0)) revert ZeroAddress();
		if (to == address(0)) revert CM_ToZero();

		bytes32 ph = keccak256(bytes(password));
		BeamioContainerStorageV07.Layout storage l = BeamioContainerStorageV07.layout();
		BeamioContainerStorageV07.Pool storage p = l.pools[ph];

		if (!p.active) revert FP_NotFound(ph);
		if (p.expiry != 0 && block.timestamp > p.expiry) revert FP_Expired(ph);
		if (p.remaining == 0) revert FP_OutOfStock(ph);
		if (l.poolClaimed[ph][claimer]) revert FP_AlreadyClaimed(ph, claimer);

		// items must match template hash
		bytes32 ih = hashItems(items);
		if (ih != p.itemsHash) revert FP_ItemsMismatch();

		// consume one share of reserve
		ContainerItem[] memory baseItems = abi.decode(p.itemsData, (ContainerItem[]));
		_reserveSub(baseItems);

		l.poolClaimed[ph][claimer] = true;
		p.remaining -= 1;

		_containerMain(to, items);

		emit FaucetClaimed(ph, claimer, to, p.remaining);

		// auto-close when empty
		if (p.remaining == 0) {
			delete l.pools[ph];
		}
	}
}
