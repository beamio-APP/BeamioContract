import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { verifyContract } from "./utils/verifyContract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 使用变通方法部署 BeamioAccount
 * 由于 Factory 的 getAddress 有问题，我们尝试直接调用 Factory 的内部逻辑
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  console.log("=".repeat(60));
  console.log("使用变通方法部署 BeamioAccount");
  console.log("=".repeat(60));
  console.log("目标 EOA:", TARGET_EOA);
  console.log("部署账户:", signer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "ETH");
  
  const networkInfo = await ethers.provider.getNetwork();
  console.log("网络:", networkInfo.name, "(Chain ID:", networkInfo.chainId.toString() + ")");
  console.log();
  
  // 读取 Factory 和 Deployer 地址
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const factoryFile = path.join(deploymentsDir, `${networkInfo.name}-FactoryAndModule.json`);
  
  if (!fs.existsSync(factoryFile)) {
    throw new Error("未找到 Factory 部署记录");
  }
  
  const deploymentData = JSON.parse(fs.readFileSync(factoryFile, "utf-8"));
  const factoryAddress = deploymentData.contracts.beamioFactoryPaymaster.address;
  const deployerAddress = deploymentData.contracts.beamioFactoryPaymaster.deployer;
  
  console.log("Factory 地址:", factoryAddress);
  console.log("Deployer 地址:", deployerAddress);
  console.log();
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  
  // 检查权限
  const isPayMaster = await factory.isPayMaster(signer.address);
  console.log("是否为 Paymaster:", isPayMaster);
  
  if (!isPayMaster) {
    throw new Error("部署账户不是 Paymaster，无法部署");
  }
  
  // 计算预期地址
  const currentIndex = await factory.nextIndexOfCreator(TARGET_EOA);
  const salt = await accountDeployer.computeSalt(TARGET_EOA, currentIndex);
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  
  console.log("当前账户索引:", currentIndex.toString());
  console.log("Salt:", salt);
  
  // 准备 initCode
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (!initCode) {
    throw new Error("无法生成 initCode");
  }
  
  // 手动计算 CREATE2 地址
  const initCodeHash = ethers.keccak256(initCode);
  const hash = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes1", "address", "bytes32", "bytes32"],
      ["0xff", deployerAddress, salt, initCodeHash]
    )
  );
  const expectedAddress = ethers.getAddress("0x" + hash.slice(-40));
  
  console.log("预期账户地址:", expectedAddress);
  
  // 检查是否已部署
  const code = await ethers.provider.getCode(expectedAddress);
  const alreadyDeployed = code !== "0x" && code.length > 2;
  console.log("账户是否已部署:", alreadyDeployed);
  
  if (alreadyDeployed) {
    console.log("\n✅ 账户已部署!");
    const isRegistered = await factory.isBeamioAccount(expectedAddress);
    console.log("是否在 Factory 注册:", isRegistered);
    
    if (isRegistered) {
      console.log("✅ 账户已注册");
    } else {
      console.log("⚠️  账户未注册，尝试注册...");
      // Factory.createAccountFor 会检测到已部署的账户并注册
      try {
        const tx = await factory.createAccountFor(TARGET_EOA);
        await tx.wait();
        console.log("✅ 账户注册成功");
      } catch (error: any) {
        console.log("⚠️  注册失败:", error.message);
      }
    }
    
    // 验证合约
    console.log("\n" + "=".repeat(60));
    console.log("验证合约到区块浏览器");
    console.log("=".repeat(60));
    
    const explorerBase = networkInfo.chainId === 8453n 
      ? "https://basescan.org"
      : networkInfo.chainId === 84532n
      ? "https://sepolia.basescan.org"
      : "";
    
    if (explorerBase) {
      console.log("等待区块确认（30秒）...");
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      try {
        await verifyContract(expectedAddress, [ENTRY_POINT], "BeamioAccount");
        console.log("\n✅ 合约验证成功!");
        console.log("查看合约:", `${explorerBase}/address/${expectedAddress}#code`);
      } catch (error: any) {
        console.log("\n⚠️  合约验证失败:", error.message);
        console.log("可以稍后手动验证:");
        console.log(`  npx hardhat verify --network ${networkInfo.name} ${expectedAddress} ${ENTRY_POINT}`);
      }
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("完成!");
    console.log("=".repeat(60));
    console.log("\n📋 账户信息:");
    console.log("  EOA:", TARGET_EOA);
    console.log("  BeamioAccount:", expectedAddress);
    console.log("  Factory:", factoryAddress);
    
    if (explorerBase) {
      console.log("\n🔗 链接:");
      console.log("  查看账户:", `${explorerBase}/address/${expectedAddress}`);
    }
    
    return;
  }
  
  // 账户未部署，但由于 Factory 的 getAddress 有问题，无法通过 Factory 部署
  console.log("\n" + "=".repeat(60));
  console.log("部署账户");
  console.log("=".repeat(60));
  console.log("⚠️  由于 Factory 的 getAddress 有问题，无法通过 Factory 部署账户");
  console.log("   需要等待 Factory 修复或使用其他方法");
  console.log("\n预期账户地址:", expectedAddress);
  console.log("\n可以手动验证合约（如果已部署）:");
  console.log(`  npx hardhat verify --network ${networkInfo.name} ${expectedAddress} ${ENTRY_POINT}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
