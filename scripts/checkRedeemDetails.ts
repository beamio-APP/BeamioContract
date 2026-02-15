/**
 * 检查指定 card + redeem code 的链上数据，排查金额显示为 0 的原因。
 * 运行：npx hardhat run scripts/checkRedeemDetails.ts --network base
 */
import { network as networkModule } from "hardhat";

const CARD = "0x29f359eA39FEa40A94C6081924fe30f882B6520E";
const CODE = "0NOuseOnNDimVLZ7rplIVH";

const CURRENCY_NAMES: Record<number, string> = {
  0: "CAD",
  1: "USD",
  2: "JPY",
  3: "CNY",
  4: "USDC",
  5: "HKD",
  6: "EUR",
  7: "SGD",
  8: "TWD",
};

async function main() {
  const { ethers } = await networkModule.connect();
  const provider = ethers.provider;

  const cardAbi = [
    "function getRedeemStatus(bytes32 hash) view returns (bool active, uint256 totalPoints6)",
    "function currency() view returns (uint8)",
    "function pointsUnitPriceInCurrencyE6() view returns (uint256)",
  ];

  const hash = ethers.keccak256(ethers.toUtf8Bytes(CODE.trim()));
  const card = new ethers.Contract(CARD, cardAbi, provider);

  console.log("========== Redeem 链上数据检查 ==========");
  console.log("Card:", CARD);
  console.log("Code:", CODE);
  console.log("Hash (keccak256):", hash);
  console.log();

  const [[active, totalPoints6], currencyNum, priceE6Raw] = await Promise.all([
    card.getRedeemStatus(hash),
    card.currency(),
    card.pointsUnitPriceInCurrencyE6(),
  ]);
  console.log();

  const priceE6 = Number(priceE6Raw);
  const ptsPer1Currency = priceE6 > 0 ? 1_000_000 / priceE6 : 0;
  const pointsHuman = Number(ethers.formatUnits(totalPoints6, 6));
  const currency = CURRENCY_NAMES[Number(currencyNum)] ?? "?";

  console.log("1. getRedeemStatus(hash):");
  console.log("   active:", active);
  console.log("   totalPoints6 (raw):", totalPoints6.toString());
  console.log("   pointsHuman (formatUnits 6):", pointsHuman);
  console.log();

  console.log("2. currency():", currencyNum.toString(), "(" + currency + ")");
  console.log();

  console.log("3. pointsUnitPriceInCurrencyE6():", priceE6Raw.toString(), "(priceE6 =", priceE6, ")");
  console.log("   ptsPer1Currency = 1e6/priceE6 =", ptsPer1Currency);
  console.log();

  const amt = ptsPer1Currency > 0 ? pointsHuman / ptsPer1Currency : pointsHuman;
  console.log("4. 计算金额:");
  console.log("   amount = pointsHuman / ptsPer1Currency =", pointsHuman, "/", ptsPer1Currency, "=", amt);
  console.log();

  if (totalPoints6 === 0n) {
    console.log("❌ 原因：totalPoints6 = 0。新合约 getRedeemStatus 已含 token bundle 中 POINTS_ID；旧合约则 points 在 bundle 中，需升级后可见。");
  } else if (priceE6 === 0) {
    console.log("❌ 原因：pointsUnitPriceInCurrencyE6 = 0，卡片未配置单价，无法换算货币金额");
    console.log("   应显示 pointsHuman =", pointsHuman, "pts");
  } else if (amt < 0.01) {
    console.log("⚠️ 原因：金额过小 (", amt, ")，2 位小数会四舍五入为 0.00");
    console.log("   应使用 4 位小数显示:", amt.toFixed(4));
  } else {
    console.log("✅ 链上数据正常，金额应为", amt);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
