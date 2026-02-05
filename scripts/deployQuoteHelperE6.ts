/**
 * 部署新版 BeamioQuoteHelperV07（E6 单价语义）
 * 使用与现有相同的 Oracle，部署后需用此地址部署/更新 UserCard Factory
 */
import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const { ethers } = await networkModule.connect();
  const [deployer] = await ethers.getSigners();
  const networkInfo = await ethers.provider.getNetwork();
  const deploymentsDir = path.join(__dirname, "..", "deployments");

  const fullSystemFile = path.join(deploymentsDir, `${networkInfo.name}-FullSystem.json`);
  const oracleAddress = process.env.ORACLE_ADDRESS || "";
  let resolvedOracle = oracleAddress;
  if (!resolvedOracle && fs.existsSync(fullSystemFile)) {
    const data = JSON.parse(fs.readFileSync(fullSystemFile, "utf-8"));
    resolvedOracle = data.contracts?.beamioOracle?.address || "";
  }
  if (!resolvedOracle) throw new Error("Need ORACLE_ADDRESS or base-FullSystem.json beamioOracle.address");

  console.log("Deploy BeamioQuoteHelperV07 (E6 unit price)");
  console.log("Oracle:", resolvedOracle);
  console.log("Owner:", deployer.address);

  const QuoteHelper = await ethers.getContractFactory("BeamioQuoteHelperV07");
  const qh = await QuoteHelper.deploy(resolvedOracle, deployer.address);
  await qh.waitForDeployment();
  const addr = await qh.getAddress();
  console.log("QuoteHelper deployed:", addr);

  const out = path.join(deploymentsDir, `${networkInfo.name}-QuoteHelperE6.json`);
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ network: networkInfo.name, quoteHelper: addr, oracle: resolvedOracle }, null, 2));
  console.log("Saved:", out);
  console.log("\nNext: deploy UserCard Factory with this QuoteHelper:");
  console.log(`  QUOTE_HELPER_ADDRESS=${addr} npx hardhat run scripts/deployUserCardFactory.ts --network ${networkInfo.name}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
