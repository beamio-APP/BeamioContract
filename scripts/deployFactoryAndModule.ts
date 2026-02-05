import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { verifyContract } from "./utils/verifyContract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 部署 Factory 和 Container Module
 * 
 * 部署顺序：
 * 1. BeamioContainerModuleV07 - 容器模块（无构造函数参数）
 * 2. BeamioFactoryPaymasterV07 - Factory/Paymaster（需要多个依赖）
 * 
 * Factory 构造函数参数：
 * - initialAccountLimit: 初始账户限制（建议 100-1000）
 * - deployer_: BeamioAccountDeployer 地址
 * - module_: BeamioContainerModuleV07 地址
 * - quoteHelper_: BeamioQuoteHelperV07 地址
 * - userCard_: BeamioUserCard 地址
 * - usdc_: USDC 代币地址
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const [deployer] = await ethers.getSigners();
  
  console.log("=".repeat(60));
  console.log("部署 Factory 和 Container Module");
  console.log("=".repeat(60));
  console.log("部署账户:", deployer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  
  const networkInfo = await ethers.provider.getNetwork();
  console.log("网络:", networkInfo.name, "(Chain ID:", networkInfo.chainId.toString() + ")");
  
  const deploymentInfo: any = {
    network: networkInfo.name,
    chainId: networkInfo.chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {}
  };
  
  // ============================================================
  // 1. 部署 BeamioContainerModuleV07
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 1: 部署 BeamioContainerModuleV07");
  console.log("=".repeat(60));
  
  const ContainerModuleFactory = await ethers.getContractFactory("BeamioContainerModuleV07");
  const containerModule = await ContainerModuleFactory.deploy();
  await containerModule.waitForDeployment();
  const containerModuleAddress = await containerModule.getAddress();
  
  console.log("✅ BeamioContainerModuleV07 部署成功!");
  console.log("合约地址:", containerModuleAddress);
  
  deploymentInfo.contracts.beamioContainerModule = {
    address: containerModuleAddress,
    transactionHash: containerModule.deploymentTransaction()?.hash
  };
  
  // 自动验证 Container Module
  await verifyContract(containerModuleAddress, [], "BeamioContainerModuleV07");
  
  // ============================================================
  // 2. 部署 BeamioFactoryPaymasterV07
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 2: 部署 BeamioFactoryPaymasterV07");
  console.log("=".repeat(60));
  
  // 尝试从部署记录文件读取已部署的合约地址
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  let deployerAddressFromFile = "";
  let quoteHelperAddressFromFile = "";
  
  try {
    const fullSystemFile = path.join(deploymentsDir, `${networkInfo.name}-FullSystem.json`);
    if (fs.existsSync(fullSystemFile)) {
      const fullSystemData = JSON.parse(fs.readFileSync(fullSystemFile, "utf-8"));
      if (fullSystemData.contracts?.beamioAccountDeployer?.address) {
        deployerAddressFromFile = fullSystemData.contracts.beamioAccountDeployer.address;
      }
      if (fullSystemData.contracts?.beamioQuoteHelper?.address) {
        quoteHelperAddressFromFile = fullSystemData.contracts.beamioQuoteHelper.address;
      }
    }
  } catch (error) {
    // 忽略文件读取错误
  }
  
  // 从环境变量或已部署的合约获取依赖地址
  const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS || deployerAddressFromFile;
  const QUOTE_HELPER_ADDRESS = process.env.QUOTE_HELPER_ADDRESS || quoteHelperAddressFromFile;
  let USER_CARD_ADDRESS = process.env.USER_CARD_ADDRESS || "";
  
  // 根据网络自动选择 USDC 地址
  const chainId = Number(networkInfo.chainId);
  const defaultUSDCAddress = chainId === 8453 
    ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // Base Mainnet
    : "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia
  const USDC_ADDRESS = process.env.USDC_ADDRESS || defaultUSDCAddress;
  const INITIAL_ACCOUNT_LIMIT = parseInt(process.env.INITIAL_ACCOUNT_LIMIT || "100");
  
  console.log("配置参数:");
  console.log("  Container Module:", containerModuleAddress);
  console.log("  Deployer:", DEPLOYER_ADDRESS || "需要设置");
  console.log("  Quote Helper:", QUOTE_HELPER_ADDRESS || "需要设置");
  console.log("  User Card:", USER_CARD_ADDRESS || "将部署占位符合约");
  console.log("  USDC:", USDC_ADDRESS);
  console.log("  Account Limit:", INITIAL_ACCOUNT_LIMIT);
  
  // 检查必需的参数
  const missingDeps: string[] = [];
  if (!DEPLOYER_ADDRESS) missingDeps.push("DEPLOYER_ADDRESS (BeamioAccountDeployer)");
  if (!QUOTE_HELPER_ADDRESS) missingDeps.push("QUOTE_HELPER_ADDRESS (BeamioQuoteHelperV07)");
  if (!USDC_ADDRESS) missingDeps.push("USDC_ADDRESS (USDC token)");
  
  if (missingDeps.length > 0) {
    console.log("\n⚠️  缺少 Factory 部署所需的依赖:");
    missingDeps.forEach(dep => console.log(`  - ${dep}`));
    console.log("\n💡 建议:");
    const networkCmd = chainId === 8453 ? "npm run deploy:full:base" : "npm run deploy:full:base-sepolia";
    console.log(`  1. 先运行完整系统部署: ${networkCmd}`);
    console.log("  2. 或在 .env 文件中设置上述环境变量");
    console.log("\n✅ Container Module 已部署，Factory 稍后可以部署");
    console.log("    Container Module 地址:", containerModuleAddress);
    return;
  }
  
  // 如果没有提供 UserCard 地址，部署占位符合约
  let placeholderDeployed = false;
  if (!USER_CARD_ADDRESS) {
    console.log("\n" + "=".repeat(60));
    console.log("步骤 1.5: 部署 BeamioUserCardPlaceholder (临时占位符)");
    console.log("=".repeat(60));
    console.log("💡 注意: 这是临时占位符合约，用于解决 Factory 和 UserCard 的循环依赖");
    console.log("   稍后可以部署真正的 UserCard 并更新 Factory");
    
    try {
      const PlaceholderFactory = await ethers.getContractFactory("BeamioUserCardPlaceholder");
      const placeholder = await PlaceholderFactory.deploy();
      await placeholder.waitForDeployment();
      USER_CARD_ADDRESS = await placeholder.getAddress();
      placeholderDeployed = true;
      
      console.log("✅ BeamioUserCardPlaceholder 部署成功!");
      console.log("合约地址:", USER_CARD_ADDRESS);
      
      // 等待区块确认
      console.log("等待区块确认...");
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      deploymentInfo.contracts.beamioUserCardPlaceholder = {
        address: USER_CARD_ADDRESS,
        transactionHash: placeholder.deploymentTransaction()?.hash,
        note: "临时占位符合约，稍后应替换为真正的 BeamioUserCard"
      };
    } catch (error: any) {
      console.log("⚠️  占位符合约部署失败:", error.message);
      console.log("   请手动设置 USER_CARD_ADDRESS 环境变量");
      return;
    }
  }
  
  // 验证地址是否有代码
  const checkCode = async (addr: string, name: string, skipIfPlaceholder = false) => {
    const code = await ethers.provider.getCode(addr);
    if (code === "0x") {
      if (skipIfPlaceholder && placeholderDeployed) {
        console.log(`⚠️  ${name} 地址 ${addr} 代码尚未确认，继续部署...`);
        return;
      }
      throw new Error(`${name} 地址 ${addr} 没有合约代码`);
    }
  };
  
  await checkCode(DEPLOYER_ADDRESS, "Deployer");
  await checkCode(QUOTE_HELPER_ADDRESS, "Quote Helper");
  await checkCode(USER_CARD_ADDRESS, "User Card", true);
  // USDC 可能是外部合约，不检查代码
  
  console.log("\n部署 BeamioFactoryPaymasterV07...");
  
  const FactoryFactory = await ethers.getContractFactory("BeamioFactoryPaymasterV07");
  const factory = await FactoryFactory.deploy(
    INITIAL_ACCOUNT_LIMIT,
    DEPLOYER_ADDRESS,
    containerModuleAddress,
    QUOTE_HELPER_ADDRESS,
    USER_CARD_ADDRESS,
    USDC_ADDRESS
  );
  
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  
  console.log("✅ BeamioFactoryPaymasterV07 部署成功!");
  console.log("合约地址:", factoryAddress);
  
  deploymentInfo.contracts.beamioFactoryPaymaster = {
    address: factoryAddress,
    initialAccountLimit: INITIAL_ACCOUNT_LIMIT,
    deployer: DEPLOYER_ADDRESS,
    containerModule: containerModuleAddress,
    quoteHelper: QUOTE_HELPER_ADDRESS,
    userCard: USER_CARD_ADDRESS,
    usdc: USDC_ADDRESS,
    transactionHash: factory.deploymentTransaction()?.hash
  };
  
  // 自动验证 Factory
  await verifyContract(
    factoryAddress,
    [
      INITIAL_ACCOUNT_LIMIT,
      DEPLOYER_ADDRESS,
      containerModuleAddress,
      QUOTE_HELPER_ADDRESS,
      USER_CARD_ADDRESS,
      USDC_ADDRESS
    ],
    "BeamioFactoryPaymasterV07"
  );
  
  // ============================================================
  // 保存部署信息
  // ============================================================
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const deploymentFile = path.join(deploymentsDir, `${networkInfo.name}-FactoryAndModule.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("\n" + "=".repeat(60));
  console.log("部署完成!");
  console.log("=".repeat(60));
  console.log("\n部署信息已保存到:", deploymentFile);
  
  console.log("\n📋 部署摘要:");
  console.log("  - BeamioContainerModuleV07:", containerModuleAddress);
  console.log("  - BeamioFactoryPaymasterV07:", factoryAddress);
  
  console.log("\n⚠️  重要提示:");
  console.log("  1. Factory 会自动尝试设置 Deployer 的 Factory 地址");
  console.log("  2. 可以使用 Factory 创建和管理 BeamioAccount");
  console.log("  3. Factory 同时作为 Paymaster，可以为账户支付 Gas");
  
  if (placeholderDeployed) {
    console.log("\n🔔 占位符合约提示:");
    console.log("  ⚠️  当前 Factory 使用的是占位符 UserCard 地址");
    console.log("  📝 部署真正的 BeamioUserCard 后，请更新 Factory:");
    console.log(`     await factory.setUserCard(realUserCardAddress);`);
    console.log("  💡 真正的 UserCard 需要使用 Factory 地址作为 gateway");
  }
  
  console.log("\n📚 下一步:");
  console.log("  - 使用 Factory 创建账户: factory.createAccount(...)");
  console.log("  - 或使用已部署的 BeamioAccount 调用 initialize(factory, module)");
  if (placeholderDeployed) {
    console.log("  - 部署真正的 BeamioUserCard 并更新 Factory 的 userCard 地址");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
