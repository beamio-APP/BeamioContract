import { network as networkModule } from "hardhat";
import { getBeamioAccount } from "./utils/getBeamioAccount.js";

async function main() {
  const { ethers } = await networkModule.connect();
  const eoaAddress = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  const factoryAddress = "0xc6162bcD4108b373914c6D06c5C486626C238169";
  
  console.log("查询 EOA:", eoaAddress);
  console.log("Factory:", factoryAddress);
  console.log();
  
  // 直接查询 Factory
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  console.log("1. 查询主要账户 (beamioAccountOf):");
  try {
    const primaryAccount = await factory.beamioAccountOf(eoaAddress);
    console.log("   结果:", primaryAccount);
    console.log("   是否为零地址:", primaryAccount === ethers.ZeroAddress);
  } catch (error: any) {
    console.log("   错误:", error.message);
  }
  
  console.log("\n2. 计算账户地址 (getAddress):");
  try {
    const computedAddress = await factory.getAddress(eoaAddress, 0);
    console.log("   计算的地址:", computedAddress);
    
    const code = await ethers.provider.getCode(computedAddress);
    console.log("   是否有代码:", code !== "0x" && code.length > 2);
    
    if (code !== "0x" && code.length > 2) {
      const isRegistered = await factory.isBeamioAccount(computedAddress);
      console.log("   是否在 Factory 注册:", isRegistered);
    }
  } catch (error: any) {
    console.log("   错误:", error.message);
  }
  
  console.log("\n3. 使用工具函数查询:");
  try {
    const result = await getBeamioAccount(eoaAddress, factoryAddress);
    console.log("   结果:", JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.log("   错误:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
