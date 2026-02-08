/**
 * 一次性修复：当链上 QuoteHelper 参数顺序与当前源码不一致导致 CCSA 购卡 UC_PriceZero 时，
 * 用当前源码部署新的 BeamioQuoteHelperV07（使用现有 Oracle），并在两个 Factory 上 setQuoteHelper(新地址)。
 *
 * 要求：
 * - 当前 signer 为 Card Factory (BeamioUserCardFactoryPaymasterV07) 的 owner
 * - 当前 signer 为 AA Factory (BeamioFactoryPaymasterV07) 的 admin（或能调 setQuoteHelper 的权限）
 * - 使用现有 Oracle 地址（从 deployments/base-FullAccountAndUserCard.json 或 ORACLE_ADDRESS）
 *
 * 运行：npx hardhat run scripts/deployQuoteHelperV07AndSetFactories.ts --network base
 */
import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const fullPath = path.join(deploymentsDir, "base-FullAccountAndUserCard.json");

  const data = fs.existsSync(fullPath) ? JSON.parse(fs.readFileSync(fullPath, "utf-8")) : {};
  const existing = data.existing || {};
  const contracts = data.contracts || {};
  const OLD_QUOTE_HELPER = existing.beamioQuoteHelper || "";

  const ORACLE = process.env.ORACLE_ADDRESS || existing.beamioOracle || "";
  const CARD_FACTORY = contracts.beamioUserCardFactoryPaymaster?.address || process.env.CARD_FACTORY || "";
  const AA_FACTORY = contracts.beamioFactoryPaymaster?.address || process.env.AA_FACTORY || "";

  if (!ORACLE || !CARD_FACTORY || !AA_FACTORY) {
    throw new Error("缺少 Oracle / Card Factory / AA Factory 地址。请设置 ORACLE_ADDRESS、或确保 deployments/base-FullAccountAndUserCard.json 含 existing.beamioOracle 与 contracts。");
  }

  console.log("Oracle (已有):", ORACLE);
  console.log("Card Factory:", CARD_FACTORY);
  console.log("AA Factory:", AA_FACTORY);
  console.log("Signer:", signer.address);
  console.log();

  const QuoteHelper = await ethers.getContractFactory("BeamioQuoteHelperV07");
  const newQuoteHelper = await QuoteHelper.deploy(ORACLE, signer.address);
  await newQuoteHelper.waitForDeployment();
  const newAddr = await newQuoteHelper.getAddress();
  console.log("已部署 BeamioQuoteHelperV07:", newAddr);

  const cardFactory = await ethers.getContractAt("BeamioUserCardFactoryPaymasterV07", CARD_FACTORY);
  const aaFactory = await ethers.getContractAt("BeamioFactoryPaymasterV07", AA_FACTORY);

  const cardOwner = await cardFactory.owner();
  if (cardOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`当前 signer 不是 Card Factory owner（owner=${cardOwner}），无法 setQuoteHelper`);
  }

  const tx1 = await cardFactory.setQuoteHelper(newAddr);
  await tx1.wait();
  console.log("Card Factory.setQuoteHelper(新 QuoteHelper) 已执行, tx:", tx1.hash);

  try {
    const tx2 = await aaFactory.setQuoteHelper(newAddr);
    await tx2.wait();
    console.log("AA Factory.setQuoteHelper(新 QuoteHelper) 已执行, tx:", tx2.hash);
  } catch (e: any) {
    console.warn("AA Factory.setQuoteHelper 失败（可能需 admin 权限）:", e?.message || e);
    console.warn("请由 AA Factory admin 手动调用 setQuoteHelper(" + newAddr + ")");
  }

  // 更新 base-FullAccountAndUserCard.json
  data.existing = data.existing || {};
  data.existing.beamioQuoteHelper = newAddr;
  if (data.contracts?.beamioUserCardFactoryPaymaster) data.contracts.beamioUserCardFactoryPaymaster.quoteHelper = newAddr;
  if (data.contracts?.beamioFactoryPaymaster) data.contracts.beamioFactoryPaymaster.quoteHelper = newAddr;
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log("已更新 deployments/base-FullAccountAndUserCard.json");

  // 将其他部署文件中与旧 QuoteHelper 相同的地址改为新地址
  if (OLD_QUOTE_HELPER && OLD_QUOTE_HELPER !== newAddr) {
    const deploymentFiles = fs.readdirSync(deploymentsDir).filter((f) => f.endsWith(".json"));
    for (const file of deploymentFiles) {
      const p = path.join(deploymentsDir, file);
      const content = fs.readFileSync(p, "utf-8");
      if (!content.includes(OLD_QUOTE_HELPER)) continue;
      const updated = content.split(OLD_QUOTE_HELPER).join(newAddr);
      fs.writeFileSync(p, updated, "utf-8");
      console.log("已更新 deployments/" + file + " 中的 QuoteHelper 引用");
    }
  }

  console.log();
  console.log("请运行 npm run check:oracle-quote:base 与 npx hardhat run scripts/checkCCSACardOnChain.ts --network base 验证。");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
