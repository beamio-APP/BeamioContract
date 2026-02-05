import { network as networkModule } from "hardhat";
import { keccak256, AbiCoder } from "ethers";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0xa6B61e49A754567638891580C617D6912268674f";
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  const deployerAddress = await factory.deployer();
  
  console.log("Deployer 地址:", deployerAddress);
  console.log("目标 EOA:", TARGET_EOA);
  
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  
  // 检查 index 0-5 的 salt
  for (let i = 0; i <= 5; i++) {
    const salt = await accountDeployer.computeSalt(TARGET_EOA, i);
    console.log(`\nIndex ${i}:`);
    console.log("  Salt (合约计算):", salt);
    
    // 手动计算 salt
    const abiCoder = AbiCoder.defaultAbiCoder();
    const manualSalt = keccak256(abiCoder.encode(["address", "uint256"], [TARGET_EOA, i]));
    console.log("  Salt (手动计算):", manualSalt);
    console.log("  是否一致:", salt === manualSalt);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
