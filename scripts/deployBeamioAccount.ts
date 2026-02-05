import { ethers, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("部署账户:", deployer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Base 链上的 EntryPoint V0.7 地址
  // 这是 ERC-4337 EntryPoint V0.7 的标准地址
  const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  
  console.log("\n部署 BeamioAccount...");
  
  // 获取合约工厂
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  
  // 部署合约，传入 EntryPoint 地址
  const beamioAccount = await BeamioAccountFactory.deploy(ENTRY_POINT_V07);
  
  await beamioAccount.waitForDeployment();
  const address = await beamioAccount.getAddress();
  
  console.log("✅ BeamioAccount 部署成功!");
  console.log("合约地址:", address);
  console.log("EntryPoint 地址:", ENTRY_POINT_V07);
  
  // 保存部署信息
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    contract: "BeamioAccount",
    address: address,
    entryPoint: ENTRY_POINT_V07,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    transactionHash: beamioAccount.deploymentTransaction()?.hash
  };
  
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const networkName = (await ethers.provider.getNetwork()).name;
  const deploymentFile = path.join(deploymentsDir, `${networkName}-BeamioAccount.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("\n部署信息已保存到:", deploymentFile);
  
  // 自动验证合约
  const { verifyContract } = await import("./utils/verifyContract.js");
  await verifyContract(address, [ENTRY_POINT_V07], "BeamioAccount");
}

// 运行部署脚本
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
