/**
 * 完整流程：重新部署 conetUSDC，验证，更新引用
 *
 * 1. redeployConetUsdcOnly — 使用 ConetTreasury 创建新 USDC，更新 BUnitAirdrop，写入部署文件
 * 2. verifyConetTreasuryAndUsdc — 验证 conetUsdc 到 CoNET Explorer
 * 3. updateConetReferences — 更新所有 conetUsdc 引用
 *
 * 运行: npx hardhat run scripts/redeployConetUsdcAndUpdate.ts --network conet
 *
 * 注意：调用者需为 ConetTreasury miner 且 BUnitAirdrop owner。
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
  console.log("\n🚀 重新部署 conetUSDC 并更新引用\n");

  run(
    "npx hardhat run scripts/redeployConetUsdcOnly.ts --network conet",
    "[1/3] 部署 conetUSDC（ConetTreasury.createERC20 + BUnitAirdrop.setConetTreasuryAndUsdc）"
  );

  run(
    "npx hardhat run scripts/verifyConetTreasuryAndUsdc.ts --network conet",
    "[2/3] 验证 ConetTreasury 与 conetUsdc 到 CoNET Explorer"
  );

  run("npx tsx scripts/updateConetReferences.ts", "[3/3] 更新所有引用");

  console.log("\n✅ 全部完成！");
  console.log("  - conet-addresses.json、conet-ConetTreasury.json 已更新");
  console.log("  - readme、规则、脚本回退地址已同步");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
