import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { verifyContract } from "./utils/verifyContract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 为指定的 EOA 地址创建 BeamioAccount
 * 
 * 使用 Factory.createAccountFor() 方法（需要 Paymaster 权限）
 * 或 Factory.createAccount() 方法（如果 EOA 自己调用）
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  
  // 从环境变量获取目标 EOA 地址
  const TARGET_EOA = process.env.TARGET_EOA || "";
  if (!TARGET_EOA) {
    console.log("❌ 错误: 未设置 TARGET_EOA 环境变量");
    console.log("用法: TARGET_EOA=0x... npm run create:account:base");
    process.exit(1);
  }
  
  if (!ethers.isAddress(TARGET_EOA)) {
    throw new Error(`无效的 EOA 地址: ${TARGET_EOA}`);
  }
  
  console.log("=".repeat(60));
  console.log("为 EOA 创建 BeamioAccount");
  console.log("=".repeat(60));
  console.log("目标 EOA:", TARGET_EOA);
  console.log("部署账户:", signer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "ETH");
  
  const networkInfo = await ethers.provider.getNetwork();
  console.log("网络:", networkInfo.name, "(Chain ID:", networkInfo.chainId.toString() + ")");
  console.log();
  
  // 从部署记录读取 Factory 地址
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  let factoryAddress = process.env.FACTORY_ADDRESS || "";
  
  if (!factoryAddress) {
    try {
      const factoryFile = path.join(deploymentsDir, `${networkInfo.name}-FactoryAndModule.json`);
      if (fs.existsSync(factoryFile)) {
        const factoryData = JSON.parse(fs.readFileSync(factoryFile, "utf-8"));
        if (factoryData.contracts?.beamioFactoryPaymaster?.address) {
          factoryAddress = factoryData.contracts.beamioFactoryPaymaster.address;
          console.log("✅ 从部署记录读取 Factory 地址:", factoryAddress);
        }
      }
    } catch (error) {
      // 忽略错误
    }
  }
  
  if (!factoryAddress) {
    throw new Error("未找到 Factory 地址，请设置 FACTORY_ADDRESS 环境变量");
  }
  
  // 获取 Factory 合约实例
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  // 检查部署账户是否是 Paymaster
  const isPayMaster = await factory.isPayMaster(signer.address);
  console.log("部署账户是否为 Paymaster:", isPayMaster);
  
  // 检查目标 EOA 是否已有账户
  const existingAccount = await factory.beamioAccountOf(TARGET_EOA);
  if (existingAccount && existingAccount !== ethers.ZeroAddress) {
    const code = await ethers.provider.getCode(existingAccount);
    const isDeployed = code !== "0x" && code.length > 2;
    
    if (isDeployed) {
      console.log("\n⚠️  该 EOA 已经有关联的 BeamioAccount!");
      console.log("账户地址:", existingAccount);
      console.log("已部署:", isDeployed);
      
      const explorerBase = networkInfo.chainId === 8453n 
        ? "https://basescan.org"
        : networkInfo.chainId === 84532n
        ? "https://sepolia.basescan.org"
        : "";
      
      if (explorerBase) {
        console.log("查看账户:", `${explorerBase}/address/${existingAccount}`);
      }
      return;
    }
  }
  
  // 检查账户限制
  const accountLimit = await factory.accountLimit();
  console.log("账户限制:", accountLimit.toString());
  
  // 获取当前 index（nextIndexOfCreator）
  const currentIndex = await factory.nextIndexOfCreator(TARGET_EOA);
  console.log("当前账户索引:", currentIndex.toString());
  
  // 使用直接调用的方式获取地址（避免 ethers.js ABI 解析问题）
  const deployerAddress = await factory.deployer();
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  const salt = await accountDeployer.computeSalt(TARGET_EOA, currentIndex);
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (!initCode) {
    throw new Error("无法生成 initCode");
  }
  
  // 使用 Factory.getAddress 直接调用（避免 ABI 解析问题）
  let expectedAddress: string;
  try {
    const iface = factory.interface;
    const data = iface.encodeFunctionData("getAddress", [TARGET_EOA, currentIndex]);
    const result = await ethers.provider.call({
      to: factoryAddress,
      data: data
    });
    const decoded = iface.decodeFunctionResult("getAddress", result);
    expectedAddress = decoded[0];
    console.log("预期账户地址 (Factory.getAddress 直接调用):", expectedAddress);
  } catch (error: any) {
    console.log("⚠️  使用 Factory.getAddress 直接调用失败，使用手动计算...");
    // 手动计算 CREATE2 地址
    const initCodeHash = ethers.keccak256(initCode);
    const hash = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes1", "address", "bytes32", "bytes32"],
        ["0xff", deployerAddress, salt, initCodeHash]
      )
    );
    expectedAddress = ethers.getAddress("0x" + hash.slice(-40));
    console.log("预期账户地址 (手动计算):", expectedAddress);
  }
  
  // 检查是否已部署
  const code = await ethers.provider.getCode(expectedAddress);
  const alreadyDeployed = code !== "0x" && code.length > 2;
  console.log("账户是否已部署:", alreadyDeployed);
  
  if (alreadyDeployed) {
    const isRegistered = await factory.isBeamioAccount(expectedAddress);
    if (isRegistered) {
      console.log("\n⚠️  该 EOA 已经有关联的 BeamioAccount!");
      console.log("账户地址:", expectedAddress);
      console.log("已部署:", true);
      console.log("已注册:", true);
      
      const explorerBase = networkInfo.chainId === 8453n 
        ? "https://basescan.org"
        : networkInfo.chainId === 84532n
        ? "https://sepolia.basescan.org"
        : "";
      
      if (explorerBase) {
        console.log("查看账户:", `${explorerBase}/address/${expectedAddress}`);
      }
      return;
    } else {
      console.log("\n⚠️  账户地址已存在合约代码，但未在 Factory 注册");
      console.log("尝试通过 createAccountFor 注册现有账户...");
      // 继续执行创建流程，Factory.createAccountFor 会检测到已部署的账户并注册它
    }
  }
  
  // 创建账户
  console.log("\n" + "=".repeat(60));
  console.log("创建 BeamioAccount");
  console.log("=".repeat(60));
  
  let accountAddress: string;
  
  if (TARGET_EOA.toLowerCase() === signer.address.toLowerCase()) {
    // 如果目标 EOA 就是部署账户，使用 createAccount()
    console.log("目标 EOA 是部署账户，使用 createAccount()...");
    const tx = await factory.createAccount();
    const receipt = await tx.wait();
    accountAddress = await factory.beamioAccountOf(signer.address);
    console.log("✅ 账户创建成功!");
    console.log("交易哈希:", receipt?.hash);
  } else if (isPayMaster) {
    // 如果部署账户是 Paymaster，使用 createAccountFor()
    console.log("部署账户是 Paymaster，使用 createAccountFor()...");
    
    // 检查地址冲突（但 Deployer.getAddress 有问题，所以先尝试调用）
    const deployerAddress = await factory.deployer();
    if (expectedAddress.toLowerCase() === deployerAddress.toLowerCase()) {
      console.log("⚠️  警告：预期账户地址与 Deployer 地址相同");
      console.log("   但 Deployer.getAddress 可能有问题，继续尝试部署...");
    }
    
    try {
      console.log("调用 factory.createAccountFor()...");
      const tx = await factory.createAccountFor(TARGET_EOA);
      const receipt = await tx.wait();
    
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
      // 如果没有事件，查询主要账户
      accountAddress = await factory.beamioAccountOf(TARGET_EOA);
    }
    
      console.log("✅ 账户创建成功!");
      console.log("交易哈希:", receipt?.hash);
    } catch (error: any) {
      console.error("❌ 创建账户失败:", error.message);
      if (error.data) {
        console.error("错误数据:", error.data);
      }
      throw error;
    }
  } else {
    throw new Error(
      "无法创建账户:\n" +
      "  - 目标 EOA 不是部署账户（无法使用 createAccount()）\n" +
      "  - 部署账户不是 Paymaster（无法使用 createAccountFor()）\n" +
      "\n解决方案:\n" +
      "  1. 使用目标 EOA 的私钥作为 PRIVATE_KEY 运行此脚本\n" +
      "  2. 或使用 Paymaster 账户运行此脚本"
    );
  }
  
  if (!accountAddress || accountAddress === ethers.ZeroAddress) {
    throw new Error("账户创建失败：未获取到账户地址");
  }
  
  console.log("\n账户地址:", accountAddress);
  
  // 验证账户
  const isRegistered = await factory.isBeamioAccount(accountAddress);
  console.log("是否在 Factory 注册:", isRegistered);
  
  // 保存部署信息
  const deploymentInfo = {
    network: networkInfo.name,
    chainId: networkInfo.chainId.toString(),
    eoa: TARGET_EOA,
    account: accountAddress,
    factory: factoryAddress,
    timestamp: new Date().toISOString(),
    transactionHash: receipt?.hash
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
  
  const explorerBase = networkInfo.chainId === 8453n 
    ? "https://basescan.org"
    : networkInfo.chainId === 84532n
    ? "https://sepolia.basescan.org"
    : "";
  
  if (explorerBase) {
    console.log("\n查看账户:", `${explorerBase}/address/${accountAddress}`);
    console.log("查看交易:", `${explorerBase}/tx/${receipt?.hash}`);
  }
  
  console.log("\n📋 账户信息:");
  console.log("  EOA:", TARGET_EOA);
  console.log("  BeamioAccount:", accountAddress);
  console.log("  Factory:", factoryAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
