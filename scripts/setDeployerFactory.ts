import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  const deployerAddr = process.env.DEPLOYER_ADDRESS || "0x9909Cbb1e70670c066c7BB0488Dbdf32d86e8961";
  const factoryAddr = process.env.USER_CARD_FACTORY_ADDRESS || "";
  if (!factoryAddr) throw new Error("Set USER_CARD_FACTORY_ADDRESS");
  const deployer = await ethers.getContractAt("BeamioUserCardDeployerV07", deployerAddr);
  const tx = await deployer.setFactory(factoryAddr);
  await tx.wait();
  console.log("Deployer factory set to", factoryAddr);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
