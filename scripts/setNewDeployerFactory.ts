import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const deployerAddress = "0x9f2f6c16C5ec6F0dF3b733A38943A1697d4CAC07";
  const factoryAddress = "0x17DB55F18e004Ea96F4D8362f5496749a423A63c";
  
  console.log("设置新 Deployer 的 Factory 地址...");
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
