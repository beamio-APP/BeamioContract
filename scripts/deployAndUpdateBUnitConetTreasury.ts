/**
 * 完整部署流程：BUnitAirdrop + ConetTreasury，验证，更新引用
 *
 * 1. 部署 BUnitAirdrop
 * 2. 部署 ConetTreasury（自动链接 BUnitAirdrop、注册 Indexer admin）
 * 3. 验证合约到 CoNET Explorer
 * 4. 运行 updateConetReferences 更新所有引用
 *
 * 运行: npx hardhat run scripts/deployAndUpdateBUnitConetTreasury.ts --network conet
 *
 * 注意：需确保 ~/.master.json 配置正确，网络稳定。
 */

import { execSync } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

function run(cmd: string, desc: string) {
  console.log("\n" + "=".repeat(60));
  console.log(desc);
  console.log("=".repeat(60));
  execSync(cmd, { stdio: "inherit", cwd: projectRoot });
}

async function main() {
  console.log("\n🚀 开始完整部署流程：BUnitAirdrop + ConetTreasury\n");

  run(
    "npx hardhat run scripts/deployBUnitAirdropToConet.ts --network conet",
    "[1/4] 部署 BUnitAirdrop"
  );

  run(
    "npx hardhat run scripts/deployConetTreasuryToConet.ts --network conet",
    "[2/4] 部署 ConetTreasury（含链接 + Indexer admin）"
  );

  run(
    "npx hardhat run scripts/verifyConetDeployments.ts --network conet",
    "[3/4] 验证合约到 CoNET Explorer"
  );

  run("npx tsx scripts/updateConetReferences.ts", "[4/4] 更新所有引用");

  console.log("\n✅ 全部完成！");
  console.log("  - conet-addresses.json 已更新");
  console.log("  - x402sdk、SilentPassUI、bizSite、CoNET-SI 引用已同步");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
