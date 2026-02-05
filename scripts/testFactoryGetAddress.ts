import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0xa6B61e49A754567638891580C617D6912268674f";
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  console.log("使用 Factory.getAddress() 计算地址...");
  const factoryComputedAddress = await factory.getAddress(TARGET_EOA, 0);
  console.log("Factory 计算的地址:", factoryComputedAddress);
  
  console.log("\n使用 Deployer 直接计算地址...");
  const deployerAddress = await factory.deployer();
  console.log("Deployer 地址:", deployerAddress);
  
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  const salt = await accountDeployer.computeSalt(TARGET_EOA, 0);
  console.log("Salt:", salt);
  
  // 使用 Factory 的 _initCode 逻辑
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  console.log("InitCode 长度:", initCode?.length || 0);
  
  if (initCode) {
    const deployerComputedAddress = await accountDeployer.getAddress(salt, initCode);
    console.log("Deployer 计算的地址:", deployerComputedAddress);
    console.log("\n地址是否一致:", factoryComputedAddress.toLowerCase() === deployerComputedAddress.toLowerCase());
  }
  
  // 检查地址上的代码
  const code1 = await ethers.provider.getCode(factoryComputedAddress);
  console.log("\nFactory 计算的地址上的代码长度:", code1.length);
  
  if (initCode) {
    const deployerComputedAddress = await accountDeployer.getAddress(salt, initCode);
    const code2 = await ethers.provider.getCode(deployerComputedAddress);
    console.log("Deployer 计算的地址上的代码长度:", code2.length);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
