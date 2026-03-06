/**
 * Claim B-Unit via BUnitAirdrop.claim() for the signer account.
 * Run: npx hardhat run scripts/claimBUnit.ts --network conet
 * Requires: signer = 0x87cAeD4e51C36a2C2ece3Aaf4ddaC9693d2405E1 (PRIVATE_KEY or ~/.master.json)
 */

import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

const BUNIT_AIRDROP = "0xc3CF7F6596aE4B761eb36975443c8D15dfAbaDAe";
const TARGET_ACCOUNT = "0x87cAeD4e51C36a2C2ece3Aaf4ddaC9693d2405E1";

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
  const { ethers } = await networkModule.connect();
  let signer = (await ethers.getSigners())[0];
  if (!signer) {
    const pk = getPrivateKey();
    signer = new ethers.Wallet(pk, ethers.provider);
  }

  if (signer.address.toLowerCase() !== TARGET_ACCOUNT.toLowerCase()) {
    throw new Error(`Signer ${signer.address} != target ${TARGET_ACCOUNT}. claim() requires claimant to be msg.sender.`);
  }

  const airdrop = await ethers.getContractAt("BUnitAirdrop", BUNIT_AIRDROP, signer);
  const hasClaimed = await airdrop.hasClaimed(signer.address);
  const claimAmount = await airdrop.claimAmount();

  console.log("=".repeat(60));
  console.log("BUnitAirdrop claim");
  console.log("=".repeat(60));
  console.log("Claimant:", signer.address);
  console.log("BUnitAirdrop:", BUNIT_AIRDROP);
  console.log("hasClaimed:", hasClaimed);
  console.log("claimAmount:", ethers.formatUnits(claimAmount, 6), "B-Units");

  if (hasClaimed) {
    console.log("\nAlready claimed. Skip.");
    return;
  }

  console.log("\nCalling claim()...");
  const tx = await airdrop.claim();
  const receipt = await tx.wait();
  console.log("claim tx:", tx.hash);
  console.log("Block:", receipt?.blockNumber);
  console.log("\nDone. Claimed", ethers.formatUnits(claimAmount, 6), "B-Units.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
