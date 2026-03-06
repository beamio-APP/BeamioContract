/**
 * ConetTreasury miner 管理（自维护 miner 表，与 BaseTreasury 对齐）
 *
 * 查询：minerCount、requiredVotes、getMiners()
 * 添加：ADD_MINERS=0x1,0x2,0x3 时，由当前 miner 调用 addMiner
 *
 * 运行: npx hardhat run scripts/addConetTreasuryMinersFromGuardianNodes.ts --network conet
 * 或: ADD_MINERS=0xAddr1,0xAddr2 npx hardhat run scripts/addConetTreasuryMinersFromGuardianNodes.ts --network conet
 */

import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getConetTreasuryAddress(): string {
  const env = process.env.CONET_TREASURY;
  if (env) return env;
  const deployPath = path.join(__dirname, "..", "deployments", "conet-ConetTreasury.json");
  if (fs.existsSync(deployPath)) {
    const d = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
    return d?.contracts?.ConetTreasury?.address || "";
  }
  throw new Error("未找到 ConetTreasury 地址，请设置 CONET_TREASURY 或确保 deployments/conet-ConetTreasury.json 存在");
}

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  const treasuryAddress = getConetTreasuryAddress();

  const treasury = await ethers.getContractAt("ConetTreasury", treasuryAddress);
  const minerCount = await treasury.minerCount();
  const requiredVotes = await treasury.requiredVotes();
  const miners = await treasury.getMiners();

  console.log("=".repeat(60));
  console.log("ConetTreasury miner 状态（自维护 miner 表）");
  console.log("=".repeat(60));
  console.log("ConetTreasury:", treasuryAddress);
  console.log("minerCount:", minerCount.toString());
  console.log("requiredVotes:", requiredVotes.toString());
  console.log("miners:", miners);

  const addMinersEnv = process.env.ADD_MINERS;
  if (addMinersEnv) {
    const toAdd = addMinersEnv.split(",").map((a) => a.trim()).filter(Boolean);
    const isMiner = await treasury.isMiner(signer.address);
    if (!isMiner) {
      throw new Error(`Signer ${signer.address} 非 miner，无法 addMiner`);
    }
    for (const addr of toAdd) {
      if (miners.includes(addr)) {
        console.log(`\n跳过 ${addr}（已是 miner）`);
        continue;
      }
      const tx = await treasury.addMiner(addr);
      await tx.wait();
      console.log(`\naddMiner(${addr}) tx:`, tx.hash);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
