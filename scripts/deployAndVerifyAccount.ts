import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { verifyContract } from "./utils/verifyContract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 为指定的 EOA 部署 BeamioAccount 并验证到区块浏览器
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  
  // 从环境变量读取 TARGET_EOA，如果没有则使用默认值
  const TARGET_EOA = process.env.TARGET_EOA || "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  console.log("=".repeat(60));
  console.log("为 EOA 部署 BeamioAccount 并验证");
  console.log("=".repeat(60));
  console.log("目标 EOA:", TARGET_EOA);
  console.log("部署账户:", signer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "ETH");
  
  const networkInfo = await ethers.provider.getNetwork();
  console.log("网络:", networkInfo.name, "(Chain ID:", networkInfo.chainId.toString() + ")");
  console.log();
  
  // 读取 Factory 地址
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  let factoryAddress = process.env.FACTORY_ADDRESS || "";
  
  if (!factoryAddress) {
    // 优先使用修复后的 Factory
    const fixedFactoryFile = path.join(deploymentsDir, `${networkInfo.name}-FactoryAndModule-fixed.json`);
    const factoryFile = path.join(deploymentsDir, `${networkInfo.name}-FactoryAndModule.json`);
    
    if (fs.existsSync(fixedFactoryFile)) {
      const deploymentData = JSON.parse(fs.readFileSync(fixedFactoryFile, "utf-8"));
      factoryAddress = deploymentData.contracts.beamioFactoryPaymaster.address;
      console.log("✅ 使用修复后的 Factory:", factoryAddress);
    } else if (fs.existsSync(factoryFile)) {
      const deploymentData = JSON.parse(fs.readFileSync(factoryFile, "utf-8"));
      factoryAddress = deploymentData.contracts.beamioFactoryPaymaster.address;
      console.log("✅ 使用 Factory:", factoryAddress);
    } else {
      throw new Error("未找到 Factory 部署记录，请设置 FACTORY_ADDRESS 环境变量");
    }
  }
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const deployerAddress = await factory.deployer();
  const isPayMaster = await factory.isPayMaster(signer.address);
  
  console.log("Deployer 地址:", deployerAddress);
  console.log("是否为 Paymaster:", isPayMaster);
  console.log();
  
  // 计算预期地址
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  const currentIndex = await factory.nextIndexOfCreator(TARGET_EOA);
  const salt = await accountDeployer.computeSalt(TARGET_EOA, currentIndex);
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (!initCode) {
    throw new Error("无法生成 initCode");
  }
  
  // 使用直接调用获取地址
  const iface = factory.interface;
  const data = iface.encodeFunctionData("getAddress", [TARGET_EOA, currentIndex]);
  const result = await ethers.provider.call({
    to: factoryAddress,
    data: data
  });
  const decoded = iface.decodeFunctionResult("getAddress", result);
  const expectedAddress = decoded[0];
  
  console.log("预期账户地址:", expectedAddress);
  
  // 检查是否已部署
  const code = await ethers.provider.getCode(expectedAddress);
  const alreadyDeployed = code !== "0x" && code.length > 2;
  console.log("账户是否已部署:", alreadyDeployed);
  
  if (alreadyDeployed) {
    const isRegistered = await factory.isBeamioAccount(expectedAddress);
    console.log("是否在 Factory 注册:", isRegistered);
    
    if (isRegistered) {
      console.log("\n✅ 账户已存在并已注册!");
      console.log("账户地址:", expectedAddress);
    } else {
      console.log("\n⚠️  账户已部署但未注册，尝试注册...");
      // 继续执行创建流程，Factory 会自动注册
    }
  }
  
  // 创建账户
  console.log("\n" + "=".repeat(60));
  console.log("创建 BeamioAccount");
  console.log("=".repeat(60));
  
  let accountAddress: string;
  let txHash: string | undefined;
  
  if (TARGET_EOA.toLowerCase() === signer.address.toLowerCase()) {
    console.log("目标 EOA 是部署账户，使用 createAccount()...");
    try {
      const tx = await factory.createAccount();
      const receipt = await tx.wait();
      txHash = receipt?.hash;
      accountAddress = await factory.beamioAccountOf(signer.address);
      console.log("✅ 账户创建成功!");
    } catch (error: any) {
      console.error("❌ createAccount 失败:", error.message);
      throw error;
    }
  } else if (isPayMaster) {
    console.log("部署账户是 Paymaster，使用 createAccountFor()...");
    try {
      // 估算 gas，如果失败则使用固定值
      let gasLimit: bigint | undefined;
      try {
        gasLimit = await factory.createAccountFor.estimateGas(TARGET_EOA);
        console.log("估算的 Gas:", gasLimit.toString());
      } catch (error: any) {
        console.log("⚠️  Gas 估算失败，使用固定值 5000000");
        gasLimit = 5000000n;
      }
      
      const tx = await factory.createAccountFor(TARGET_EOA, { gasLimit });
      const receipt = await tx.wait();
      txHash = receipt?.hash;
      
      // 从事件中获取账户地址
      const events = receipt?.logs.filter((log: any) => {
        try {
          const parsed = factory.interface.parseLog(log);
          return parsed?.name === "AccountCreated";
        } catch {
          return false;
        }
      });
      
      if (events && events.length > 0) {
        const parsed = factory.interface.parseLog(events[0]);
        accountAddress = parsed?.args.account;
      } else {
        accountAddress = await factory.beamioAccountOf(TARGET_EOA);
      }
      
      console.log("✅ 账户创建成功!");
    } catch (error: any) {
      console.error("❌ createAccountFor 失败:", error.message);
      if (error.data) {
        console.error("错误数据:", error.data);
      }
      throw error;
    }
  } else {
    throw new Error("无法创建账户：部署账户不是 Paymaster，且目标 EOA 不是部署账户");
  }
  
  if (!accountAddress || accountAddress === ethers.ZeroAddress) {
    throw new Error("账户创建失败：未获取到账户地址");
  }
  
  console.log("\n账户地址:", accountAddress);
  if (txHash) {
    console.log("交易哈希:", txHash);
  }
  
  // 验证账户
  const isRegistered = await factory.isBeamioAccount(accountAddress);
  console.log("是否在 Factory 注册:", isRegistered);
  
  // 验证合约到区块浏览器
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
      await verifyContract(accountAddress, [ENTRY_POINT], "BeamioAccount");
      console.log("\n✅ 合约验证成功!");
      console.log("查看合约:", `${explorerBase}/address/${accountAddress}#code`);
    } catch (error: any) {
      console.log("\n⚠️  合约验证失败:", error.message);
      console.log("可以稍后手动验证:");
      console.log(`  npx hardhat verify --network ${networkInfo.name} ${accountAddress} ${ENTRY_POINT}`);
    }
  } else {
    console.log("⚠️  未知网络，跳过验证");
  }
  
  // 保存部署信息
  const deploymentInfo = {
    network: networkInfo.name,
    chainId: networkInfo.chainId.toString(),
    eoa: TARGET_EOA,
    account: accountAddress,
    factory: factoryAddress,
    deployer: deployerAddress,
    entryPoint: ENTRY_POINT,
    timestamp: new Date().toISOString(),
    transactionHash: txHash
  };
  
  const deploymentFile = path.join(deploymentsDir, `${networkInfo.name}-Account-${TARGET_EOA.slice(0, 10)}.json`);
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("\n" + "=".repeat(60));
  console.log("部署完成!");
  console.log("=".repeat(60));
  console.log("\n部署信息已保存到:", deploymentFile);
  
  if (explorerBase) {
    console.log("\n📋 账户信息:");
    console.log("  EOA:", TARGET_EOA);
    console.log("  BeamioAccount:", accountAddress);
    console.log("  Factory:", factoryAddress);
    console.log("\n🔗 链接:");
    console.log("  查看账户:", `${explorerBase}/address/${accountAddress}`);
    if (txHash) {
      console.log("  查看交易:", `${explorerBase}/tx/${txHash}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
