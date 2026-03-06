/**
 * Check if BUnitAirdrop is admin of BUint (required for consumeFromUser/consumeFuel)
 * Run: npx tsx scripts/checkBUnitAirdropBUintAdmin.ts
 */
import { ethers } from "ethers";

const BUINT = "0x4A3E59519eE72B9Dcf376f0617fF0a0a5a1ef879";
const BUNIT_AIRDROP = "0xa7410a532544aB7d1bA70701D9D0E389e4f4Cc1F";
const RPC = process.env.CONET_RPC || "https://mainnet-rpc.conet.network";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const buint = new ethers.Contract(BUINT, ["function admins(address) view returns (bool)"], provider);
  const isAdmin = await buint.admins(BUNIT_AIRDROP);
  console.log("BUint:", BUINT);
  console.log("BUnitAirdrop:", BUNIT_AIRDROP);
  console.log("BUnitAirdrop is BUint admin:", isAdmin);
}

main().catch(console.error);
