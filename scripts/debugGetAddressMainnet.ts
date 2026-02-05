import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0xa6B61e49A754567638891580C617D6912268674f";
  const eoaAddress = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  console.log("=".repeat(60));
  console.log("Base 主网查询详情");
  console.log("=".repeat(60));
  console.log("Factory 地址:", factoryAddress);
  console.log("EOA 地址:", eoaAddress);
  console.log();
  
  // 获取 Deployer 地址
  const deployerAddress = await factory.deployer();
  console.log("1. Deployer 地址:", deployerAddress);
  
  // 查询主要账户
  console.log("\n2. 查询主要账户 (beamioAccountOf):");
  try {
    const primaryAccount = await factory.beamioAccountOf(eoaAddress);
    console.log("   结果:", primaryAccount);
    console.log("   是否为零地址:", primaryAccount === ethers.ZeroAddress);
    
    if (primaryAccount && primaryAccount !== ethers.ZeroAddress) {
      const code = await ethers.provider.getCode(primaryAccount);
      const isDeployed = code !== "0x" && code.length > 2;
      console.log("   是否有代码:", isDeployed);
      
      if (isDeployed) {
        const isRegistered = await factory.isBeamioAccount(primaryAccount);
        console.log("   是否在 Factory 注册:", isRegistered);
      }
    }
  } catch (error: any) {
    console.log("   错误:", error.message);
  }
  
  // 计算账户地址
  console.log("\n3. 计算账户地址 (getAddress):");
  try {
    const computedAddress = await factory.getAddress(eoaAddress, 0);
    console.log("   计算的地址:", computedAddress);
    console.log("   是否与 Factory 相同:", computedAddress.toLowerCase() === factoryAddress.toLowerCase());
    
    if (computedAddress.toLowerCase() !== factoryAddress.toLowerCase()) {
      const code = await ethers.provider.getCode(computedAddress);
      const isDeployed = code !== "0x" && code.length > 2;
      console.log("   是否有代码:", isDeployed);
      
      if (isDeployed) {
        const isRegistered = await factory.isBeamioAccount(computedAddress);
        console.log("   是否在 Factory 注册:", isRegistered);
      }
    } else {
      console.log("   ⚠️  计算的地址与 Factory 地址相同，这可能是 Factory.getAddress() 的实现问题");
    }
  } catch (error: any) {
    console.log("   错误:", error.message);
  }
  
  // 尝试查询多个索引
  console.log("\n4. 查询多个索引 (0-5):");
  for (let i = 0; i <= 5; i++) {
    try {
      const computedAddress = await factory.getAddress(eoaAddress, i);
      if (computedAddress.toLowerCase() !== factoryAddress.toLowerCase()) {
        const code = await ethers.provider.getCode(computedAddress);
        const isDeployed = code !== "0x" && code.length > 2;
        
        if (isDeployed) {
          const isRegistered = await factory.isBeamioAccount(computedAddress);
          console.log(`   索引 ${i}: ${computedAddress} - 已部署: ${isDeployed}, 已注册: ${isRegistered}`);
        }
      }
    } catch (error) {
      // 忽略错误
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("查询完成");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
