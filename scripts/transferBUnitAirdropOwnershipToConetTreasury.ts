/**
 * 将 BUnitAirdrop 的 owner 转移给 ConetTreasury
 *
 * 需当前 owner（部署者）执行。运行:
 *   npx hardhat run scripts/transferBUnitAirdropOwnershipToConetTreasury.ts --network conet
 */

import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADDRESSES_PATH = path.join(__dirname, "..", "deployments", "conet-addresses.json");
const MASTER_PATH = path.join(homedir(), ".master.json");

async function main() {
  if (!fs.existsSync(ADDRESSES_PATH)) {
    throw new Error("未找到 deployments/conet-addresses.json");
  }
  const data = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf-8"));
  const bunitAirdropAddr = data.BUnitAirdrop;
  const conetTreasuryAddr = data.ConetTreasury;

  if (!bunitAirdropAddr || !conetTreasuryAddr) {
    throw new Error("conet-addresses.json 缺少 BUnitAirdrop 或 ConetTreasury 地址");
  }

  if (!fs.existsSync(MASTER_PATH)) {
    throw new Error("未找到 ~/.master.json");
  }
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf-8"));
  const pk = master?.settle_contractAdmin?.[0];
  if (!pk) throw new Error("~/.master.json 中 settle_contractAdmin[0] 为空");

  const { ethers } = await networkModule.connect();
  const signer = new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, ethers.provider);

  const airdrop = await ethers.getContractAt("BUnitAirdrop", bunitAirdropAddr);
  const currentOwner = await airdrop.owner();

  if (currentOwner.toLowerCase() === conetTreasuryAddr.toLowerCase()) {
    console.log("BUnitAirdrop owner 已是 ConetTreasury，无需转移");
    return;
  }

  if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `当前 signer (${signer.address}) 不是 BUnitAirdrop owner (${currentOwner})，无法执行 transferOwnership`
    );
  }

  console.log("=".repeat(60));
  console.log("转移 BUnitAirdrop owner 至 ConetTreasury");
  console.log("=".repeat(60));
  console.log("BUnitAirdrop:", bunitAirdropAddr);
  console.log("ConetTreasury (新 owner):", conetTreasuryAddr);
  console.log("当前 owner:", currentOwner);

  const tx = await airdrop.transferOwnership(conetTreasuryAddr);
  await tx.wait();
  console.log("\n✅ transferOwnership 完成，tx:", tx.hash);

  const newOwner = await airdrop.owner();
  console.log("新 owner:", newOwner);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
