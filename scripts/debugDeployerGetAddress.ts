import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0xa6B61e49A754567638891580C617D6912268674f";
  const eoaAddress = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const deployerAddress = await factory.deployer();
  
  console.log("=".repeat(60));
  console.log("直接使用 Deployer 计算地址");
  console.log("=".repeat(60));
  console.log("Factory:", factoryAddress);
  console.log("Deployer:", deployerAddress);
  console.log("EOA:", eoaAddress);
  console.log();
  
  // 获取 Deployer 合约
  const deployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  
  // 计算 salt
  const salt = await deployer.computeSalt(eoaAddress, 0);
  console.log("Salt:", salt);
  
  // 构建 initCode（使用与部署脚本相同的方式）
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  
  // 方法 1: 使用 getDeployTransaction（推荐）
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode1 = deployTx.data;
  console.log("方法 1 - getDeployTransaction:");
  console.log("  InitCode 长度:", initCode1?.length || 0);
  
  // 方法 2: 手动构建（与 Factory._initCode() 相同）
  const initCode2 = ethers.concat([
    BeamioAccountFactory.bytecode,
    ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ENTRY_POINT])
  ]);
  console.log("方法 2 - 手动构建:");
  console.log("  InitCode 长度:", initCode2.length);
  
  // 使用方法 1（与部署脚本一致）
  const initCode = initCode1 || initCode2;
  console.log("\n使用的 InitCode 长度:", initCode?.length || 0);
  
  // 使用 Deployer 计算地址
  const computedAddress = await deployer.getAddress(salt, initCode);
  console.log("\nDeployer 计算的地址:", computedAddress);
  console.log("是否与 Factory 相同:", computedAddress.toLowerCase() === factoryAddress.toLowerCase());
  
  // 检查地址是否有代码
  const code = await ethers.provider.getCode(computedAddress);
  const isDeployed = code !== "0x" && code.length > 2;
  console.log("是否有代码:", isDeployed);
  
  if (isDeployed) {
    // 检查是否在 Factory 注册
    const isRegistered = await factory.isBeamioAccount(computedAddress);
    console.log("是否在 Factory 注册:", isRegistered);
    
    // 尝试读取账户的 owner
    try {
      const account = await ethers.getContractAt("BeamioAccount", computedAddress);
      const owner = await account.owner();
      console.log("账户 Owner:", owner);
      console.log("Owner 是否匹配 EOA:", owner.toLowerCase() === eoaAddress.toLowerCase());
    } catch (error: any) {
      console.log("读取账户信息失败:", error.message);
    }
  }
  
  // 对比 Factory.getAddress 的结果
  console.log("\n对比 Factory.getAddress():");
  const factoryComputedAddress = await factory.getAddress(eoaAddress, 0);
  console.log("Factory 计算的地址:", factoryComputedAddress);
  console.log("两者是否相同:", computedAddress.toLowerCase() === factoryComputedAddress.toLowerCase());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
