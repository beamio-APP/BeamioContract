import { network as networkModule } from "hardhat";
const BUNIT_AIRDROP = "0xa7410a532544aB7d1bA70701D9D0E389e4f4Cc1F";
async function main() {
  const { ethers } = await networkModule.connect();
  const airdrop = await ethers.getContractAt("BUnitAirdrop", BUNIT_AIRDROP);
  const idx = await airdrop.beamioIndexerDiamond();
  console.log("beamioIndexerDiamond:", idx);
}
main().catch(console.error);
