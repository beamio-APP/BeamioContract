import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { verifyContract } from "./utils/verifyContract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 部署 BeamioUserCardFactoryPaymasterV07
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const [deployer] = await ethers.getSigners();
  
  console.log("=".repeat(60));
  console.log("部署 BeamioUserCardFactoryPaymasterV07");
  console.log("=".repeat(60));
  console.log("部署账户:", deployer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  
  const networkInfo = await ethers.provider.getNetwork();
  console.log("网络:", networkInfo.name, "(Chain ID:", networkInfo.chainId.toString() + ")");
  console.log();
  
  // 从环境变量或部署记录读取依赖地址
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  
  // 读取 USDC 地址
  const chainId = Number(networkInfo.chainId);
  const defaultUSDCAddress = chainId === 8453 
    ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // Base Mainnet
    : "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia
  const USDC_ADDRESS = process.env.USDC_ADDRESS || defaultUSDCAddress;
  
  // 读取其他依赖地址
  const fullSystemFile = path.join(deploymentsDir, `${networkInfo.name}-FullSystem.json`);
  let REDEEM_MODULE_ADDRESS = process.env.REDEEM_MODULE_ADDRESS || "";
  let QUOTE_HELPER_ADDRESS = process.env.QUOTE_HELPER_ADDRESS || "";
  let DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS || "";
  let AA_FACTORY_ADDRESS = process.env.AA_FACTORY_ADDRESS || "";
  
  if (fs.existsSync(fullSystemFile)) {
    const deploymentData = JSON.parse(fs.readFileSync(fullSystemFile, "utf-8"));
    if (!REDEEM_MODULE_ADDRESS && deploymentData.contracts?.redeemModule?.address) {
      REDEEM_MODULE_ADDRESS = deploymentData.contracts.redeemModule.address;
    }
    if (!QUOTE_HELPER_ADDRESS && deploymentData.contracts?.beamioQuoteHelper?.address) {
      QUOTE_HELPER_ADDRESS = deploymentData.contracts.beamioQuoteHelper.address;
    }
    if (!DEPLOYER_ADDRESS && deploymentData.contracts?.beamioUserCardDeployer?.address) {
      DEPLOYER_ADDRESS = deploymentData.contracts.beamioUserCardDeployer.address;
    }
    if (!AA_FACTORY_ADDRESS && deploymentData.contracts?.beamioFactoryPaymaster?.address) {
      AA_FACTORY_ADDRESS = deploymentData.contracts.beamioFactoryPaymaster.address;
    }
  }
  
  // 如果没有找到，尝试从 FactoryAndModule 读取
  if (!QUOTE_HELPER_ADDRESS || !AA_FACTORY_ADDRESS) {
    const factoryFile = path.join(deploymentsDir, `${networkInfo.name}-FactoryAndModule.json`);
    if (fs.existsSync(factoryFile)) {
      const factoryData = JSON.parse(fs.readFileSync(factoryFile, "utf-8"));
      if (!QUOTE_HELPER_ADDRESS && factoryData.contracts?.beamioFactoryPaymaster?.quoteHelper) {
        QUOTE_HELPER_ADDRESS = factoryData.contracts.beamioFactoryPaymaster.quoteHelper;
      }
      if (!AA_FACTORY_ADDRESS && factoryData.contracts?.beamioFactoryPaymaster?.address) {
        AA_FACTORY_ADDRESS = factoryData.contracts.beamioFactoryPaymaster.address;
      }
    }
  }
  
  // 检查必需的参数
  if (!REDEEM_MODULE_ADDRESS) {
    console.log("⚠️  未找到 REDEEM_MODULE_ADDRESS，需要先部署 RedeemModule");
    console.log("   或设置环境变量: REDEEM_MODULE_ADDRESS=0x...");
  }
  if (!QUOTE_HELPER_ADDRESS) {
    console.log("⚠️  未找到 QUOTE_HELPER_ADDRESS");
  }
  if (!DEPLOYER_ADDRESS) {
    console.log("⚠️  未找到 DEPLOYER_ADDRESS，需要先部署 BeamioUserCardDeployerV07");
    console.log("   或设置环境变量: DEPLOYER_ADDRESS=0x...");
  }
  if (!AA_FACTORY_ADDRESS) {
    console.log("⚠️  未找到 AA_FACTORY_ADDRESS（BeamioFactoryPaymasterV07）");
  }
  
  console.log("\n配置参数:");
  console.log("  USDC:", USDC_ADDRESS);
  console.log("  Redeem Module:", REDEEM_MODULE_ADDRESS || "(未设置)");
  console.log("  Quote Helper:", QUOTE_HELPER_ADDRESS || "(未设置)");
  console.log("  Deployer:", DEPLOYER_ADDRESS || "(未设置)");
  console.log("  AA Factory:", AA_FACTORY_ADDRESS || "(未设置)");
  console.log("  Owner:", deployer.address);
  console.log();
  
  // 如果缺少必需的参数，先部署或提示
  if (!REDEEM_MODULE_ADDRESS || !DEPLOYER_ADDRESS) {
    console.log("❌ 缺少必需的依赖合约，无法部署 UserCard Factory");
    console.log("\n需要先部署:");
    if (!REDEEM_MODULE_ADDRESS) {
      console.log("  - RedeemModule");
    }
    if (!DEPLOYER_ADDRESS) {
      console.log("  - BeamioUserCardDeployerV07");
    }
    return;
  }
  
  // 验证地址是否有代码
  const checkCode = async (addr: string, name: string, optional = false) => {
    const code = await ethers.provider.getCode(addr);
    if (code === "0x" && !optional) {
      throw new Error(`${name} 地址 ${addr} 没有合约代码`);
    } else if (code === "0x" && optional) {
      console.log(`⚠️  ${name} 地址 ${addr} 没有合约代码（可选）`);
    }
  };
  
  await checkCode(USDC_ADDRESS, "USDC", true);
  if (REDEEM_MODULE_ADDRESS) await checkCode(REDEEM_MODULE_ADDRESS, "Redeem Module");
  if (QUOTE_HELPER_ADDRESS) await checkCode(QUOTE_HELPER_ADDRESS, "Quote Helper");
  if (DEPLOYER_ADDRESS) await checkCode(DEPLOYER_ADDRESS, "Deployer");
  if (AA_FACTORY_ADDRESS) await checkCode(AA_FACTORY_ADDRESS, "AA Factory", true);
  
  console.log("✅ 所有依赖地址验证通过");
  console.log();
  
  // 部署 BeamioUserCardFactoryPaymasterV07
  console.log("部署 BeamioUserCardFactoryPaymasterV07...");
  
  const FactoryFactory = await ethers.getContractFactory("BeamioUserCardFactoryPaymasterV07");
  const factory = await FactoryFactory.deploy(
    USDC_ADDRESS,
    REDEEM_MODULE_ADDRESS,
    QUOTE_HELPER_ADDRESS || ethers.ZeroAddress,
    DEPLOYER_ADDRESS,
    AA_FACTORY_ADDRESS || ethers.ZeroAddress,
    deployer.address // initialOwner
  );
  
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  
  console.log("✅ BeamioUserCardFactoryPaymasterV07 部署成功!");
  console.log("合约地址:", factoryAddress);
  
  // 等待区块确认
  console.log("等待区块确认...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // 验证合约
  console.log("\n验证合约...");
  await verifyContract(
    factoryAddress,
    [
      USDC_ADDRESS,
      REDEEM_MODULE_ADDRESS,
      QUOTE_HELPER_ADDRESS || ethers.ZeroAddress,
      DEPLOYER_ADDRESS,
      AA_FACTORY_ADDRESS || ethers.ZeroAddress,
      deployer.address
    ],
    "BeamioUserCardFactoryPaymasterV07"
  );
  
  // 保存部署信息
  const deploymentInfo = {
    network: networkInfo.name,
    chainId: networkInfo.chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      beamioUserCardFactoryPaymaster: {
        address: factoryAddress,
        usdc: USDC_ADDRESS,
        redeemModule: REDEEM_MODULE_ADDRESS,
        quoteHelper: QUOTE_HELPER_ADDRESS || null,
        deployer: DEPLOYER_ADDRESS,
        aaFactory: AA_FACTORY_ADDRESS || null,
        owner: deployer.address,
        transactionHash: factory.deploymentTransaction()?.hash
      }
    }
  };
  
  const deploymentFile = path.join(deploymentsDir, `${networkInfo.name}-UserCardFactory.json`);
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("\n" + "=".repeat(60));
  console.log("部署完成!");
  console.log("=".repeat(60));
  console.log("\n部署信息已保存到:", deploymentFile);
  console.log("\n📋 部署摘要:");
  console.log("  - BeamioUserCardFactoryPaymasterV07:", factoryAddress);
  console.log("\n下一步:");
  console.log("  使用此 Factory 为 EOA 创建 UserCard:");
  console.log(`    TARGET_EOA=0x... USER_CARD_FACTORY_ADDRESS=${factoryAddress} npx hardhat run scripts/createUserCardForEOA.ts --network ${networkInfo.name}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
