/**
 * BaseTreasury Miner 投票转出 ERC20（如 USDC）
 *
 * 运行: npx hardhat run scripts/voteBaseTreasuryTransfer.ts --network base
 *
 * 环境变量:
 *   TX_HASH=0x837361cb2404a12e931943c111d7c1755bd054f57ee320b3f15f686daa3dd242
 *   RECIPIENT=0xEaBF0A98aC208647247eAA25fDD4eB0e67793d61
 *   AMOUNT_USDC=6.133132   (USDC 数量，6 位精度)
 *   TOKEN=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  (可选，默认 Base USDC)
 *
 * 需要: PRIVATE_KEY 或 ~/.master.json settle_contractAdmin[0]，且为 BaseTreasury miner
 */
import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

const BASE_TREASURY = "0x5c64a8b0935DA72d60933bBD8cD10579E1C40c58";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function getPrivateKey(): string {
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY;
  const setupPath = path.join(homedir(), ".master.json");
  if (fs.existsSync(setupPath)) {
    try {
      const master = JSON.parse(fs.readFileSync(setupPath, "utf-8"));
      const key = master?.settle_contractAdmin?.[0];
      if (key) return key.startsWith("0x") ? key : "0x" + key;
    } catch {}
  }
  throw new Error("Need PRIVATE_KEY in .env or ~/.master.json settle_contractAdmin");
}

async function main() {
  const txHashHex = process.env.TX_HASH;
  const recipient = process.env.RECIPIENT;
  const amountHuman = process.env.AMOUNT_USDC ? parseFloat(process.env.AMOUNT_USDC) : 0;
  const token = (process.env.TOKEN || BASE_USDC) as `0x${string}`;

  if (!txHashHex || !recipient) {
    throw new Error("Need TX_HASH and RECIPIENT env vars");
  }
  if (amountHuman <= 0) {
    throw new Error("Need AMOUNT_USDC > 0");
  }

  const txHash = (txHashHex.length === 66 && txHashHex.startsWith("0x")
    ? txHashHex
    : "0x" + txHashHex.replace(/^0x/, "").padStart(64, "0")) as `0x${string}`;

  const amountRaw = BigInt(Math.round(amountHuman * 1e6));

  const { ethers } = await network.connect();
  const pk = getPrivateKey();
  const signer = new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, ethers.provider);

  const treasury = await ethers.getContractAt("BaseTreasury", BASE_TREASURY, signer);

  const isMiner = await treasury.isMiner(signer.address);
  if (!isMiner) {
    throw new Error(`Signer ${signer.address} is not a BaseTreasury miner`);
  }

  const [assetType, propToken, propRecipient, propAmount, voteCount, executed] =
    await treasury.getProposal(txHash);

  console.log("=".repeat(60));
  console.log("BaseTreasury vote: transfer ERC20");
  console.log("=".repeat(60));
  console.log("txHash:", txHash);
  console.log("recipient:", recipient);
  console.log("token:", token);
  console.log("amount:", amountHuman, "USDC (raw:", amountRaw.toString() + ")");
  console.log("Current proposal:", {
    assetType: assetType,
    token: propToken,
    recipient: propRecipient,
    amount: propAmount?.toString?.(),
    voteCount: voteCount?.toString?.(),
    executed: !!executed,
  });

  if (executed) {
    console.log("\nProposal already executed, no need to vote");
    return;
  }

  const tx = await treasury.vote(txHash, false, token, recipient, amountRaw);
  console.log("\nVote tx:", tx.hash);
  await tx.wait();
  console.log("Vote submitted successfully");

  const [, , , amt, vc, ex] = await treasury.getProposal(txHash);
  const required = await treasury.requiredVotes();
  console.log("After vote:", { voteCount: vc?.toString?.(), required: required.toString(), executed: !!ex });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
