/**
 * Test BaseTreasury purchaseBUnit flow:
 * 1. Check USDC balance of 0x87cAeD4e51C36a2C2ece3Aaf4ddaC9693d2405E1 on Base
 * 2. If > 0.1 USDC, approve BaseTreasury and purchase 0.01 B-Unit
 *
 * Run: npx hardhat run scripts/testPurchaseBUnitOnBase.ts --network base
 * Requires: PRIVATE_KEY in .env, or ~/.master.json settle_contractAdmin key
 */

import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

const TEST_ACCOUNT = "0x87cAeD4e51C36a2C2ece3Aaf4ddaC9693d2405E1"
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const BASE_TREASURY = "0x5c64a8b0935DA72d60933bBD8cD10579E1C40c58"
const MIN_BALANCE_USDC = 0.02
const PURCHASE_AMOUNT_USDC = 0.02

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
] as const

function getPrivateKey(): string {
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY
  const setupPath = path.join(homedir(), ".master.json")
  if (fs.existsSync(setupPath)) {
    try {
      const master = JSON.parse(fs.readFileSync(setupPath, "utf-8"))
      const key = master?.settle_contractAdmin?.[0]
      if (key) return key.startsWith("0x") ? key : "0x" + key
    } catch {}
  }
  throw new Error("Need PRIVATE_KEY in .env or ~/.master.json settle_contractAdmin")
}

async function main() {
  const { ethers } = await networkModule.connect()
  let signer = (await ethers.getSigners())[0]
  if (!signer) {
    const pk = getPrivateKey()
    signer = new ethers.Wallet(pk, ethers.provider)
  }

  if (signer.address.toLowerCase() !== TEST_ACCOUNT.toLowerCase()) {
    console.warn(`Signer ${signer.address} != test account ${TEST_ACCOUNT}. Proceeding anyway.`)
  }

  const usdc = new ethers.Contract(BASE_USDC, ERC20_ABI, signer)
  const balanceRaw = await usdc.balanceOf(TEST_ACCOUNT)
  const balanceHuman = Number(ethers.formatUnits(balanceRaw, 6))

  console.log("=".repeat(60))
  console.log("Test purchaseBUnit on Base")
  console.log("=".repeat(60))
  console.log("Account:", TEST_ACCOUNT)
  console.log("USDC balance:", balanceHuman, "USDC")
  console.log("BaseTreasury:", BASE_TREASURY)

  if (balanceHuman < MIN_BALANCE_USDC) {
    console.log(`\nBalance ${balanceHuman} < ${MIN_BALANCE_USDC} USDC. Skip purchase.`)
    return
  }

  const purchaseAmountRaw = ethers.parseUnits(PURCHASE_AMOUNT_USDC.toString(), 6)
  const treasury = await ethers.getContractAt("BaseTreasury", BASE_TREASURY, signer)

  console.log(`\nApproving ${PURCHASE_AMOUNT_USDC} USDC to BaseTreasury...`)
  const approveTx = await usdc.approve(BASE_TREASURY, purchaseAmountRaw)
  await approveTx.wait()
  console.log("Approve tx:", approveTx.hash)

  console.log(`\nCalling purchaseBUnit(usdc, ${PURCHASE_AMOUNT_USDC})...`)
  const purchaseTx = await treasury.purchaseBUnit(BASE_USDC, purchaseAmountRaw)
  const receipt = await purchaseTx.wait()
  console.log("purchaseBUnit tx:", purchaseTx.hash)
  console.log("Block:", receipt?.blockNumber)
  console.log("\nDone. Miner nodes should pick up BUnitPurchased and vote on ConetTreasury.")
  console.log("\nTo manually vote: TX_HASH=" + purchaseTx.hash + " USER=" + TEST_ACCOUNT + " USDC_AMOUNT=" + PURCHASE_AMOUNT_USDC + " npx hardhat run scripts/voteUsdc2BUnit.ts --network conet")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
