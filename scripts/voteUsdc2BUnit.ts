/**
 * Miner 投票 USDC 购买 B-Unit
 *
 * 运行: npx hardhat run scripts/voteUsdc2BUnit.ts --network conet
 *
 * 环境变量或参数:
 *   TX_HASH=0x66cf1e5058010fc12f962e56196c6235d6fd3dc51b7100ec88b745510ecddda2
 *   USER=0x513087820Af94A7f4d21bC5B68090f3080022E0e
 *   USDC_AMOUNT=0.01  (USDC 数量，内部转为 6 位精度 10000)
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
  const txHashHex = process.env.TX_HASH || "0x66cf1e5058010fc12f962e56196c6235d6fd3dc51b7100ec88b745510ecddda2";
  const user = (process.env.VOTE_USER || process.env.USER_ADDR || "0x513087820Af94A7f4d21bC5B68090f3080022E0e").toLowerCase();
  if (!user.startsWith("0x") || user.length !== 42) throw new Error("user 必须是有效的以太坊地址");
  const usdcAmountHuman = process.env.USDC_AMOUNT ? parseFloat(process.env.USDC_AMOUNT) : 0.01;

  // USDC 6 decimals: 0.01 USDC = 10000
  const usdcAmount = BigInt(Math.round(usdcAmountHuman * 1e6));

  const txHash = txHashHex.length === 66 && txHashHex.startsWith("0x")
    ? txHashHex as `0x${string}`
    : ("0x" + txHashHex.replace(/^0x/, "").padStart(64, "0")) as `0x${string}`;

  if (!fs.existsSync(ADDRESSES_PATH)) throw new Error("未找到 conet-addresses.json");
  const addrs = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf-8"));
  const treasuryAddr = addrs.ConetTreasury;
  if (!treasuryAddr) throw new Error("缺少 ConetTreasury");

  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf-8"));
  const pk = master?.settle_contractAdmin?.[0];
  if (!pk) throw new Error("~/.master.json settle_contractAdmin[0] 为空");

  const { ethers } = await networkModule.connect();
  const signer = new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, ethers.provider);

  const treasury = await ethers.getContractAt("ConetTreasury", treasuryAddr);

  const isMiner = await treasury.isMiner(signer.address);
  if (!isMiner) {
    throw new Error(`Signer ${signer.address} 不是 ConetTreasury miner`);
  }

  const [existingUser, existingAmount, voteCount, executed] = await treasury.getUsdc2BUnitProposal(txHash);
  console.log("=".repeat(60));
  console.log("投票 USDC 购买 B-Unit");
  console.log("=".repeat(60));
  console.log("txHash:", txHash);
  console.log("user:", user);
  console.log("usdcAmount (raw):", usdcAmount.toString(), `(${usdcAmountHuman} USDC)`);
  console.log("当前提案:", {
    user: existingUser,
    usdcAmount: existingAmount?.toString?.(),
    voteCount: voteCount?.toString?.(),
    executed: !!executed,
  });

  if (executed) {
    console.log("\n提案已执行，无需再投票");
    return;
  }

  // 提高 gas limit 确保 mintForUsdcPurchase 内 syncTokenAction 有足够 gas（约 55 万）
  const gasLimit = process.env.GAS_LIMIT ? parseInt(process.env.GAS_LIMIT, 10) : 1_500_000;
  const tx = await treasury.voteAirdropBUnitFromBase(txHash, user, usdcAmount, { gasLimit });
  console.log("\n投票 tx:", tx.hash);
  await tx.wait();
  console.log("✅ 投票成功");

  const [u, amt, vc, ex] = await treasury.getUsdc2BUnitProposal(txHash);
  console.log("投票后:", { user: u, usdcAmount: amt?.toString?.(), voteCount: vc?.toString?.(), executed: !!ex });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
