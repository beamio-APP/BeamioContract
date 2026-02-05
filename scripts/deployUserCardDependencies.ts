import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { verifyContract } from "./utils/verifyContract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 部署 UserCard 系统的依赖合约
 * - RedeemModule
 * - BeamioUserCardDeployerV07
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const [deployer] = await ethers.getSigners();
  
  console.log("=".repeat(60));
  console.log("部署 UserCard 系统依赖合约");
  console.log("=".repeat(60));
  console.log("部署账户:", deployer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  
  const networkInfo = await ethers.provider.getNetwork();
  console.log("网络:", networkInfo.name, "(Chain ID:", networkInfo.chainId.toString() + ")");
  console.log();
  
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  // ============================================================
  // 1. 部署 RedeemModule
  // ============================================================
  console.log("=".repeat(60));
  console.log("步骤 1: 部署 RedeemModule");
  console.log("=".repeat(60));
  
  const RedeemModuleFactory = await ethers.getContractFactory("BeamioUserCardRedeemModuleVNext");
  const redeemModule = await RedeemModuleFactory.deploy();
  await redeemModule.waitForDeployment();
  const redeemModuleAddress = await redeemModule.getAddress();
  
  console.log("✅ RedeemModule 部署成功!");
  console.log("合约地址:", redeemModuleAddress);
  
  // 等待区块确认
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // 验证合约
  await verifyContract(redeemModuleAddress, [], "BeamioUserCardRedeemModuleVNext");
  
  // ============================================================
  // 2. 部署 BeamioUserCardDeployerV07
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 2: 部署 BeamioUserCardDeployerV07");
  console.log("=".repeat(60));
  
  const UserCardDeployerFactory = await ethers.getContractFactory("BeamioUserCardDeployerV07");
  const userCardDeployer = await UserCardDeployerFactory.deploy();
  await userCardDeployer.waitForDeployment();
  const userCardDeployerAddress = await userCardDeployer.getAddress();
  
  console.log("✅ BeamioUserCardDeployerV07 部署成功!");
  console.log("合约地址:", userCardDeployerAddress);
  
  // 等待区块确认
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // 验证合约
  await verifyContract(userCardDeployerAddress, [], "BeamioUserCardDeployerV07");
  
  // ============================================================
  // 保存部署信息
  // ============================================================
  const deploymentInfo = {
    network: networkInfo.name,
    chainId: networkInfo.chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      redeemModule: {
        address: redeemModuleAddress,
        transactionHash: redeemModule.deploymentTransaction()?.hash
      },
      beamioUserCardDeployer: {
        address: userCardDeployerAddress,
        transactionHash: userCardDeployer.deploymentTransaction()?.hash
      }
    }
  };
  
  const deploymentFile = path.join(deploymentsDir, `${networkInfo.name}-UserCardDependencies.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("\n" + "=".repeat(60));
  console.log("部署完成!");
  console.log("=".repeat(60));
  console.log("\n部署信息已保存到:", deploymentFile);
  console.log("\n📋 部署摘要:");
  console.log("  - RedeemModule:", redeemModuleAddress);
  console.log("  - BeamioUserCardDeployerV07:", userCardDeployerAddress);
  console.log("\n下一步:");
  console.log("  使用这些地址部署 BeamioUserCardFactoryPaymasterV07:");
  console.log(`    REDEEM_MODULE_ADDRESS=${redeemModuleAddress} DEPLOYER_ADDRESS=${userCardDeployerAddress} npx hardhat run scripts/deployUserCardFactory.ts --network ${networkInfo.name}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
