/**
 * Add specific miners to ConetTreasury.
 *
 * Addresses to add:
 * - 0x6bF3Aa7261e21Be5Fc781Ac09F9475c8A34AfEea
 * - 0xcbBB1371973D57e6bD45aC0dfeFD493b59F9D76B
 *
 * Run: npx hardhat run scripts/addConetTreasuryMiners.ts --network conet
 * Requires: signer must be an existing miner (e.g. deployer 0x87cAeD4e51C36a2C2ece3Aaf4ddaC9693d2405E1)
 */

import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MINERS_TO_ADD = [
  "0x6bF3Aa7261e21Be5Fc781Ac09F9475c8A34AfEea",
  "0xcbBB1371973D57e6bD45aC0dfeFD493b59F9D76B",
] as const;

function getConetTreasuryAddress(): string {
  const env = process.env.CONET_TREASURY;
  if (env) return env;
  const deployPath = path.join(__dirname, "..", "deployments", "conet-ConetTreasury.json");
  if (fs.existsSync(deployPath)) {
    const d = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
    return d?.contracts?.ConetTreasury?.address || "";
  }
  throw new Error("ConetTreasury address not found. Set CONET_TREASURY or ensure deployments/conet-ConetTreasury.json exists");
}

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  const treasuryAddress = getConetTreasuryAddress();

  const treasury = await ethers.getContractAt("ConetTreasury", treasuryAddress);
  const miners = await treasury.getMiners();

  console.log("ConetTreasury:", treasuryAddress);
  console.log("Signer:", signer.address);
  console.log("Current miners:", miners);

  const isMiner = await treasury.isMiner(signer.address);
  if (!isMiner) {
    throw new Error(`Signer ${signer.address} is not a miner. Cannot call addMiner.`);
  }

  for (const addr of MINERS_TO_ADD) {
    if (miners.includes(addr)) {
      console.log(`Skip ${addr} (already miner)`);
      continue;
    }
    const tx = await treasury.addMiner(addr);
    await tx.wait();
    console.log(`addMiner(${addr}) tx: ${tx.hash}`);
  }

  const updatedMiners = await treasury.getMiners();
  console.log("Updated miners:", updatedMiners);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
