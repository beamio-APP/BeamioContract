/**
 * Query BaseTreasury USDC balance on Base mainnet
 * Run: npx hardhat run scripts/getBaseTreasuryUsdcBalance.ts --network base
 */
import { network } from "hardhat"

const BASE_TREASURY = "0x5c64a8b0935DA72d60933bBD8cD10579E1C40c58"
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

async function main() {
  const { ethers } = await network.connect()
  const treasury = await ethers.getContractAt("BaseTreasury", BASE_TREASURY)
  const raw = await treasury.erc20Balance(BASE_USDC)
  console.log("BaseTreasury USDC balance (raw):", raw.toString())
  console.log("BaseTreasury USDC balance (formatted):", ethers.formatUnits(raw, 6), "USDC")
}

main().catch(console.error)
