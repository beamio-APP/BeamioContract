/**
 * 使用 Hardhat 编译产物创建一张 CCSA 卡（BeamioUserCard）。
 * owner EOA、currency、1 CAD = 1 token 可通过环境变量覆盖。
 *
 * 用法：
 *   CARD_OWNER=0xEaBF0A98aC208647247eAA25fDD4eB0e67793d61 npm run create:ccsa:base
 *   npm run create:ccsa:base
 */
import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CARD_OWNER = "0xEaBF0A98aC208647247eAA25fDD4eB0e67793d61";
const DEFAULT_URI = "https://api.beamio.io/metadata/{id}.json";
const CAD_CURRENCY = 0; // BeamioCurrency.CurrencyType.CAD
const ONE_CAD_E6 = 1_000_000n;

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();

  const cardOwner = process.env.CARD_OWNER
    ? ethers.getAddress(process.env.CARD_OWNER)
    : ethers.getAddress(DEFAULT_CARD_OWNER);

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const fullFile = path.join(deploymentsDir, "base-FullAccountAndUserCard.json");
  if (!fs.existsSync(fullFile)) {
    throw new Error("未找到 deployments/base-FullAccountAndUserCard.json");
  }
  const data = JSON.parse(fs.readFileSync(fullFile, "utf-8"));
  const cardFactoryAddress = data.contracts?.beamioUserCardFactoryPaymaster?.address;
  if (!cardFactoryAddress) {
    throw new Error("部署文件中缺少 beamioUserCardFactoryPaymaster 地址");
  }

  const cardFactory = await ethers.getContractAt(
    "BeamioUserCardFactoryPaymasterV07",
    cardFactoryAddress
  );
  const factoryOwner = await cardFactory.owner();
  const isPm = await cardFactory.isPaymaster(signer.address);
  if (signer.address.toLowerCase() !== factoryOwner.toLowerCase() && !isPm) {
    throw new Error(
      `当前 signer ${signer.address} 不是工厂 owner (${factoryOwner}) 且不是 paymaster，无法发卡`
    );
  }

  // gateway 必须为 Card Factory，否则工厂校验 c.factoryGateway() != address(this) 会 revert
  const gateway = cardFactoryAddress;
  const BeamioUserCard = await ethers.getContractFactory("BeamioUserCard");
  const deployTx = await BeamioUserCard.getDeployTransaction(
    DEFAULT_URI,
    CAD_CURRENCY,
    ONE_CAD_E6,
    cardOwner,
    gateway
  );
  const initCode = deployTx?.data;
  if (!initCode) throw new Error("Failed to build BeamioUserCard initCode");

  console.log("Creating CCSA card...");
  console.log("  Card Factory:", cardFactoryAddress);
  console.log("  Caller:", signer.address);
  console.log("  Card owner (EOA):", cardOwner);
  console.log("  Currency: CAD (0), Unit price: 1 CAD = 1 token (1e6)");
  console.log("  Gateway (factoryGateway):", gateway);

  const tx = await cardFactory.createCardCollectionWithInitCode(
    cardOwner,
    CAD_CURRENCY,
    ONE_CAD_E6,
    initCode
  );
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Transaction failed");

  let cardAddress: string | undefined;
  const iface = cardFactory.interface;
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "CardDeployed") {
        cardAddress = parsed.args?.card ?? parsed.args?.userCard;
        break;
      }
    } catch {
      // skip
    }
  }
  if (!cardAddress && Array.isArray(await cardFactory.cardsOfOwner(cardOwner))) {
    const cards = await cardFactory.cardsOfOwner(cardOwner);
    if (cards.length > 0) cardAddress = cards[cards.length - 1];
  }
  if (!cardAddress || !ethers.isAddress(cardAddress)) {
    throw new Error("Could not resolve new card address from receipt");
  }

  console.log("CCSA card created:", cardAddress);
  console.log("Update address: NEW_CCSA_ADDRESS=" + cardAddress + " node scripts/replace-ccsa-address.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
