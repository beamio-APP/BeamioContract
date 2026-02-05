import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0xa6B61e49A754567638891580C617D6912268674f";
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  
  // 方法 1: 使用 getDeployTransaction（脚本中使用的方法）
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode1 = deployTx.data;
  console.log("方法 1 (getDeployTransaction):");
  console.log("  InitCode 长度:", initCode1?.length || 0);
  console.log("  InitCode Hash:", ethers.keccak256(initCode1 || "0x"));
  
  // 方法 2: 手动构建（与 Factory._initCode() 相同）
  const initCode2 = ethers.concat([
    BeamioAccountFactory.bytecode,
    ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ENTRY_POINT])
  ]);
  console.log("\n方法 2 (手动构建，与 Factory._initCode() 相同):");
  console.log("  InitCode 长度:", initCode2.length);
  console.log("  InitCode Hash:", ethers.keccak256(initCode2));
  
  console.log("\n两者是否相同:", (initCode1 || "0x") === initCode2);
  
  // 检查 Factory 使用的 initCode
  // 注意：Factory._initCode() 是 internal，无法直接调用
  // 但我们可以通过 getAddress 的行为来推断
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  const deployerAddress = await factory.deployer();
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  
  const salt = await accountDeployer.computeSalt(TARGET_EOA, 0);
  
  // 使用方法 1 计算地址
  const address1 = await accountDeployer.getAddress(salt, initCode1 || "0x");
  console.log("\n使用方法 1 计算的地址:", address1);
  
  // 使用方法 2 计算地址
  const address2 = await accountDeployer.getAddress(salt, initCode2);
  console.log("使用方法 2 计算的地址:", address2);
  
  // Factory.getAddress 返回的地址
  const factoryAddress_result = await factory.getAddress(TARGET_EOA, 0);
  console.log("Factory.getAddress 返回的地址:", factoryAddress_result);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
