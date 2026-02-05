import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const address = "0xBD510029d0a72bE2594c1a5FF0C939d5CDAC4B87";
  
  console.log("检查地址:", address);
  const code = await ethers.provider.getCode(address);
  console.log("合约代码长度:", code.length);
  
  // 尝试作为 Deployer 合约
  try {
    const deployer = await ethers.getContractAt("BeamioAccountDeployer", address);
    const factory = await deployer.factory();
    console.log("\n✅ 这是 BeamioAccountDeployer 合约");
    console.log("Factory 地址:", factory);
  } catch (e: any) {
    console.log("\n❌ 这不是 BeamioAccountDeployer 合约");
    console.log("错误:", e.message);
  }
  
  // 尝试作为 BeamioAccount 合约
  try {
    const account = await ethers.getContractAt("BeamioAccount", address);
    const entryPoint = await account.ENTRY_POINT();
    console.log("\n✅ 这是 BeamioAccount 合约");
    console.log("EntryPoint 地址:", entryPoint);
  } catch (e: any) {
    console.log("\n❌ 这不是 BeamioAccount 合约");
    console.log("错误:", e.message);
  }
  
  // 检查交易哈希对应的合约
  const txHash = "0xdfc81b1ceb8eabcc6ad6a345bec3b31c68404a41223b2cc5e93adffa2693bbab";
  console.log("\n检查部署交易:", txHash);
  const tx = await ethers.provider.getTransaction(txHash);
  if (tx) {
    console.log("交易存在");
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (receipt) {
      console.log("合约地址:", receipt.contractAddress);
      console.log("创建者地址:", receipt.from);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
