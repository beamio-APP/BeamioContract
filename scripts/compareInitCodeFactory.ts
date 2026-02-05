import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0x17DB55F18e004Ea96F4D8362f5496749a423A63c";
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  
  // 方法 1: 使用 getDeployTransaction（脚本中使用的方法）
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode1 = deployTx.data;
  
  // 方法 2: 手动构建（与 Factory._initCode() 相同）
  const initCode2 = ethers.concat([
    BeamioAccountFactory.bytecode,
    ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ENTRY_POINT])
  ]);
  
  console.log("方法 1 (getDeployTransaction):");
  console.log("  InitCode 长度:", initCode1?.length || 0);
  console.log("  InitCode Hash:", ethers.keccak256(initCode1 || "0x"));
  
  console.log("\n方法 2 (手动构建，与 Factory._initCode() 相同):");
  console.log("  InitCode 长度:", initCode2.length);
  console.log("  InitCode Hash:", ethers.keccak256(initCode2));
  
  console.log("\n两者是否相同:", (initCode1 || "0x") === initCode2);
  
  if ((initCode1 || "0x") !== initCode2) {
    console.log("\n⚠️  InitCode 不一致！这可能是问题所在");
    console.log("   方法 1 前 100 个字符:", (initCode1 || "0x").slice(0, 100));
    console.log("   方法 2 前 100 个字符:", initCode2.slice(0, 100));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
