import { ethers, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { verifyContract } from "./utils/verifyContract.js";

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("部署账户:", deployer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  console.log("\n部署 BeamioAccountDeployer...");
  
  // 部署 BeamioAccountDeployer
  const BeamioAccountDeployerFactory = await ethers.getContractFactory("BeamioAccountDeployer");
  const deployerContract = await BeamioAccountDeployerFactory.deploy();
  
  await deployerContract.waitForDeployment();
  const deployerAddress = await deployerContract.getAddress();
  
  console.log("✅ BeamioAccountDeployer 部署成功!");
  console.log("部署器地址:", deployerAddress);
  
  // 保存部署信息
  const network = await ethers.provider.getNetwork();
  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId.toString(),
    contract: "BeamioAccountDeployer",
    address: deployerAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    transactionHash: deployerContract.deploymentTransaction()?.hash
  };
  
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const deploymentFile = path.join(deploymentsDir, `${network.name}-BeamioAccountDeployer.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("\n部署信息已保存到:", deploymentFile);
  
  // 自动验证合约
  await verifyContract(deployerAddress, [], "BeamioAccountDeployer");
  
  console.log("\n✅ 部署完成!");
  console.log("\n下一步:");
  console.log("1. 设置 Factory 地址: deployerContract.setFactory(factoryAddress)");
  console.log("2. 使用部署器部署 AA 账号");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
