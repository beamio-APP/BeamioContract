import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const deployerAddress = "0xBD510029d0a72bE2594c1a5FF0C939d5CDAC4B87";
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (!initCode) {
    throw new Error("无法生成 initCode");
  }
  
  console.log("Deployer 地址:", deployerAddress);
  console.log("InitCode 长度:", initCode.length);
  
  // 测试不同的 salt
  for (let i = 0; i <= 2; i++) {
    const salt = await accountDeployer.computeSalt(TARGET_EOA, i);
    console.log(`\nIndex ${i}:`);
    console.log("  Salt:", salt);
    
    // 直接调用 getAddress
    try {
      const address = await accountDeployer.getAddress(salt, initCode);
      console.log("  地址:", address);
    } catch (error: any) {
      console.log("  错误:", error.message);
    }
    
    // 尝试使用静态调用
    try {
      const address = await accountDeployer.getAddress.staticCall(salt, initCode);
      console.log("  地址 (staticCall):", address);
    } catch (error: any) {
      console.log("  错误 (staticCall):", error.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
