import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { verifyContract } from "./utils/verifyContract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 重新部署修复后的 Factory 合约
 * 
 * 修复内容：
 * - Factory.getAddress 现在直接计算 CREATE2 地址，不依赖 Deployer.getAddress
 * - 解决了 ethers.js 对 bytes calldata 参数的 ABI 解析问题
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  
  const networkInfo = await ethers.provider.getNetwork();
  const networkName = networkInfo.name;
  
  console.log("=".repeat(60));
  console.log("重新部署修复后的 Factory 合约");
  console.log("=".repeat(60));
  console.log("网络:", networkName);
  console.log("部署账户:", signer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "ETH");
  console.log();
  
  // 读取现有部署记录
  const deploymentFile = path.join(__dirname, "..", "deployments", `${networkName}-FactoryAndModule.json`);
  let existingDeployment: any = null;
  
  if (fs.existsSync(deploymentFile)) {
    existingDeployment = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
    console.log("📋 现有部署记录:");
    console.log("  Factory:", existingDeployment.contracts.beamioFactoryPaymaster.address);
    console.log("  Deployer:", existingDeployment.contracts.beamioFactoryPaymaster.deployer);
    console.log("  Container Module:", existingDeployment.contracts.beamioFactoryPaymaster.containerModule);
    console.log();
  }
  
  // 从环境变量或现有部署记录读取依赖地址
  const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS || existingDeployment?.contracts.beamioFactoryPaymaster.deployer;
  const CONTAINER_MODULE_ADDRESS = process.env.CONTAINER_MODULE_ADDRESS || existingDeployment?.contracts.beamioContainerModule.address;
  const QUOTE_HELPER_ADDRESS = process.env.QUOTE_HELPER_ADDRESS || existingDeployment?.contracts.beamioFactoryPaymaster.quoteHelper;
  const USER_CARD_ADDRESS = process.env.USER_CARD_ADDRESS || existingDeployment?.contracts.beamioFactoryPaymaster.userCard;
  
  // 根据网络自动选择 USDC 地址
  const chainId = Number(networkInfo.chainId);
  const defaultUSDCAddress = chainId === 8453 
    ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // Base Mainnet
    : "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia
  const USDC_ADDRESS = process.env.USDC_ADDRESS || defaultUSDCAddress;
  const INITIAL_ACCOUNT_LIMIT = parseInt(process.env.INITIAL_ACCOUNT_LIMIT || "100");
  
  console.log("配置参数:");
  console.log("  Container Module:", CONTAINER_MODULE_ADDRESS);
  console.log("  Deployer:", DEPLOYER_ADDRESS);
  console.log("  Quote Helper:", QUOTE_HELPER_ADDRESS);
  console.log("  User Card:", USER_CARD_ADDRESS);
  console.log("  USDC:", USDC_ADDRESS);
  console.log("  Account Limit:", INITIAL_ACCOUNT_LIMIT);
  console.log();
  
  // 检查必需的参数
  if (!DEPLOYER_ADDRESS || !CONTAINER_MODULE_ADDRESS || !QUOTE_HELPER_ADDRESS || !USER_CARD_ADDRESS || !USDC_ADDRESS) {
    throw new Error("缺少必需的依赖地址，请设置环境变量或确保部署记录存在");
  }
  
  // 验证地址是否有代码
  const checkCode = async (addr: string, name: string) => {
    const code = await ethers.provider.getCode(addr);
    if (code === "0x") {
      throw new Error(`${name} 地址 ${addr} 没有合约代码`);
    }
  };
  
  await checkCode(DEPLOYER_ADDRESS, "Deployer");
  await checkCode(CONTAINER_MODULE_ADDRESS, "Container Module");
  await checkCode(QUOTE_HELPER_ADDRESS, "Quote Helper");
  await checkCode(USER_CARD_ADDRESS, "User Card");
  
  console.log("✅ 所有依赖地址验证通过");
  console.log();
  
  // 部署修复后的 Factory
  console.log("部署修复后的 BeamioFactoryPaymasterV07...");
  console.log("修复内容：Factory.getAddress 直接计算 CREATE2 地址");
  
  const FactoryFactory = await ethers.getContractFactory("BeamioFactoryPaymasterV07");
  const factory = await FactoryFactory.deploy(
    INITIAL_ACCOUNT_LIMIT,
    DEPLOYER_ADDRESS,
    CONTAINER_MODULE_ADDRESS,
    QUOTE_HELPER_ADDRESS,
    USER_CARD_ADDRESS,
    USDC_ADDRESS
  );
  
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  
  console.log("✅ 修复后的 Factory 部署成功!");
  console.log("新 Factory 地址:", factoryAddress);
  console.log();
  
  // 设置 Deployer 的 Factory 地址
  console.log("设置 Deployer 的 Factory 地址...");
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", DEPLOYER_ADDRESS);
  const currentFactory = await accountDeployer.factory();
  
  if (currentFactory === ethers.ZeroAddress) {
    const setFactoryTx = await accountDeployer.setFactory(factoryAddress);
    await setFactoryTx.wait();
    console.log("✅ Deployer Factory 地址设置成功");
  } else {
    console.log("⚠️  Deployer 已有 Factory 地址:", currentFactory);
    if (currentFactory.toLowerCase() !== factoryAddress.toLowerCase()) {
      console.log("   注意：Deployer 指向旧的 Factory 地址");
      console.log("   新 Factory 地址:", factoryAddress);
    }
  }
  console.log();
  
  // 测试修复后的 getAddress
  console.log("测试修复后的 Factory.getAddress...");
  const testEOA = signer.address;
  const expectedAddress = await factory.getAddress(testEOA, 0);
  console.log("测试 EOA:", testEOA);
  console.log("Factory.getAddress 返回:", expectedAddress);
  
  // 手动计算验证
  const salt = await accountDeployer.computeSalt(testEOA, 0);
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (initCode) {
    const initCodeHash = ethers.keccak256(initCode);
    const manualHash = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes1", "address", "bytes32", "bytes32"],
        ["0xff", DEPLOYER_ADDRESS, salt, initCodeHash]
      )
    );
    const manualAddress = ethers.getAddress("0x" + manualHash.slice(-40));
    
    console.log("手动计算地址:", manualAddress);
    if (expectedAddress.toLowerCase() === manualAddress.toLowerCase()) {
      console.log("✅ Factory.getAddress 返回正确地址！");
    } else {
      console.log("❌ Factory.getAddress 返回错误地址");
      console.log("   这不应该发生，请检查代码");
    }
  }
  console.log();
  
  // 保存部署信息
  const deploymentInfo = {
    network: networkName,
    chainId: networkInfo.chainId.toString(),
    deployer: signer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      beamioFactoryPaymaster: {
        address: factoryAddress,
        initialAccountLimit: INITIAL_ACCOUNT_LIMIT,
        deployer: DEPLOYER_ADDRESS,
        containerModule: CONTAINER_MODULE_ADDRESS,
        quoteHelper: QUOTE_HELPER_ADDRESS,
        userCard: USER_CARD_ADDRESS,
        usdc: USDC_ADDRESS,
        transactionHash: factory.deploymentTransaction()?.hash,
        note: "修复后的 Factory：getAddress 直接计算 CREATE2 地址"
      },
      beamioContainerModule: existingDeployment?.contracts.beamioContainerModule || {
        address: CONTAINER_MODULE_ADDRESS
      }
    }
  };
  
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  // 保存为新的部署记录（带时间戳）
  const newDeploymentFile = path.join(deploymentsDir, `${networkName}-FactoryAndModule-fixed.json`);
  fs.writeFileSync(newDeploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  // 也更新原部署记录（可选）
  console.log("部署信息已保存到:", newDeploymentFile);
  console.log();
  
  // 自动验证 Factory
  console.log("验证 Factory 合约...");
  await verifyContract(
    factoryAddress,
    [
      INITIAL_ACCOUNT_LIMIT,
      DEPLOYER_ADDRESS,
      CONTAINER_MODULE_ADDRESS,
      QUOTE_HELPER_ADDRESS,
      USER_CARD_ADDRESS,
      USDC_ADDRESS
    ],
    "BeamioFactoryPaymasterV07"
  );
  
  console.log();
  console.log("=".repeat(60));
  console.log("部署完成!");
  console.log("=".repeat(60));
  console.log("\n新 Factory 地址:", factoryAddress);
  console.log("\n下一步：");
  console.log("  1. 测试 Factory.getAddress 是否返回正确地址");
  console.log("  2. 测试 createAccountFor 是否能成功创建账户");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
