import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const deployerAddress = "0x794Fc963dC3F354847356EFdE4FbbF8D4b806959";
  const factoryAddress = "0xFD48F7a6bBEb0c0C1ff756C38cA7fE7544239767";
  
  console.log("设置 Deployer 的 Factory 地址...");
  console.log("Deployer:", deployerAddress);
  console.log("Factory:", factoryAddress);
  
  const deployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  const currentFactory = await deployer.factory();
  
  console.log("当前 Factory:", currentFactory);
  
  if (currentFactory === ethers.ZeroAddress) {
    console.log("设置 Factory 地址...");
    const tx = await deployer.setFactory(factoryAddress);
    await tx.wait();
    console.log("✅ Factory 地址设置成功");
    console.log("交易哈希:", tx.hash);
  } else {
    console.log("⚠️  Deployer 已有 Factory 地址:", currentFactory);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
