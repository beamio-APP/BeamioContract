/**
 * 验证 BUnitAirdrop 是否为 BeamioIndexerDiamond 的 admin。
 * 若未登记，claim 时 syncTokenAction 会 revert，被 try/catch 吞掉，导致 Indexer 无记账。
 *
 * 用法: npx hardhat run scripts/verifyBUnitAirdropIndexerAdmin.ts --network conet
 */

import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADDRESSES_PATH = path.join(__dirname, "..", "deployments", "conet-addresses.json");
const INDEXER_PATH = path.join(__dirname, "..", "deployments", "conet-IndexerDiamond.json");

const AdminFacetABI = [
  "function isAdmin(address admin) view returns (bool)",
  "function owner() view returns (address)",
];

function loadBUnitAirdropAddress(): string {
  if (!fs.existsSync(ADDRESSES_PATH)) {
    throw new Error("未找到 deployments/conet-addresses.json");
  }
  const data = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf-8"));
  const addr = data.BUnitAirdrop || data.contracts?.BUnitAirdrop?.address;
  if (!addr) throw new Error("conet-addresses.json 中缺少 BUnitAirdrop 地址");
  return addr;
}

function loadDiamondAddress(): string {
  if (!fs.existsSync(INDEXER_PATH)) {
    throw new Error("未找到 deployments/conet-IndexerDiamond.json");
  }
  const data = JSON.parse(fs.readFileSync(INDEXER_PATH, "utf-8"));
  if (!data.diamond) throw new Error("conet-IndexerDiamond.json 中缺少 diamond 字段");
  return data.diamond;
}

async function main() {
  const bunitAirdropAddr = loadBUnitAirdropAddress();
  const diamondAddr = loadDiamondAddress();

  const { ethers } = await networkModule.connect();
  const diamond = new ethers.Contract(diamondAddr, AdminFacetABI, ethers.provider);

  const isAdmin = await diamond.isAdmin(bunitAirdropAddr);
  const owner = await diamond.owner();

  console.log("=".repeat(60));
  console.log("BUnitAirdrop Indexer Admin 验证");
  console.log("=".repeat(60));
  console.log("BeamioIndexerDiamond:", diamondAddr);
  console.log("BUnitAirdrop:", bunitAirdropAddr);
  console.log("Indexer owner:", owner);
  console.log("BUnitAirdrop is admin:", isAdmin);
  console.log();

  if (!isAdmin) {
    console.log("❌ BUnitAirdrop 不是 admin！claim 时 syncTokenAction 会 revert，Indexer 无记账。");
    console.log("   请运行: npx hardhat run scripts/registerBUnitAirdropToConet.ts --network conet");
  } else {
    console.log("✅ BUnitAirdrop 已是 admin，claim 应能正常记账。");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
