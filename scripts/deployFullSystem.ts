import { ethers, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { verifyContract } from "./utils/verifyContract.js";

/**
 * 完整系统部署脚本
 * 
 * 部署顺序：
 * 1. BeamioOracle - 汇率预言机
 * 2. BeamioQuoteHelperV07 - 报价辅助合约（依赖 Oracle）
 * 3. BeamioAccountDeployer - CREATE2 部署器
 * 4. BeamioAccount - AA 账号合约（可选，如果需要直接部署）
 * 
 * 注意：BeamioUserCard 和 BeamioUserCardFactoryPaymasterV07 需要额外的配置
 * 这些合约通常通过 Factory 模式部署，不在本脚本中
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("=".repeat(60));
  console.log("完整系统部署脚本");
  console.log("=".repeat(60));
  console.log("部署账户:", deployer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  
  const network = await ethers.provider.getNetwork();
  console.log("网络:", network.name, "(Chain ID:", network.chainId.toString() + ")");
  
  const deploymentInfo: any = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {}
  };
  
  // ============================================================
  // 1. 部署 BeamioOracle
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 1: 部署 BeamioOracle");
  console.log("=".repeat(60));
  
  const BeamioOracleFactory = await ethers.getContractFactory("BeamioOracle");
  const oracle = await BeamioOracleFactory.deploy();
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  
  console.log("✅ BeamioOracle 部署成功!");
  console.log("合约地址:", oracleAddress);
  
  deploymentInfo.contracts.beamioOracle = {
    address: oracleAddress,
    transactionHash: oracle.deploymentTransaction()?.hash
  };
  
  // 自动验证 Oracle
  await verifyContract(oracleAddress, [], "BeamioOracle");
  
  // ============================================================
  // 2. 部署 BeamioQuoteHelperV07（需要 Oracle 地址）
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 2: 部署 BeamioQuoteHelperV07");
  console.log("=".repeat(60));
  console.log("Oracle 地址:", oracleAddress);
  
  const BeamioQuoteHelperFactory = await ethers.getContractFactory("BeamioQuoteHelperV07");
  const quoteHelper = await BeamioQuoteHelperFactory.deploy(oracleAddress, deployer.address);
  await quoteHelper.waitForDeployment();
  const quoteHelperAddress = await quoteHelper.getAddress();
  
  console.log("✅ BeamioQuoteHelperV07 部署成功!");
  console.log("合约地址:", quoteHelperAddress);
  
  deploymentInfo.contracts.beamioQuoteHelper = {
    address: quoteHelperAddress,
    oracle: oracleAddress,
    owner: deployer.address,
    transactionHash: quoteHelper.deploymentTransaction()?.hash
  };
  
  // 自动验证 QuoteHelper
  await verifyContract(quoteHelperAddress, [oracleAddress, deployer.address], "BeamioQuoteHelperV07");
  
  // ============================================================
  // 3. 部署 BeamioAccountDeployer
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 3: 部署 BeamioAccountDeployer");
  console.log("=".repeat(60));
  
  const BeamioAccountDeployerFactory = await ethers.getContractFactory("BeamioAccountDeployer");
  const accountDeployer = await BeamioAccountDeployerFactory.deploy();
  await accountDeployer.waitForDeployment();
  const deployerAddress = await accountDeployer.getAddress();
  
  console.log("✅ BeamioAccountDeployer 部署成功!");
  console.log("合约地址:", deployerAddress);
  
  deploymentInfo.contracts.beamioAccountDeployer = {
    address: deployerAddress,
    transactionHash: accountDeployer.deploymentTransaction()?.hash
  };
  
  // 自动验证 Deployer
  await verifyContract(deployerAddress, [], "BeamioAccountDeployer");
  
  // ============================================================
  // 4. 部署 BeamioAccount（可选）
  // ============================================================
  const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  
  console.log("\n" + "=".repeat(60));
  console.log("步骤 4: 部署 BeamioAccount (可选)");
  console.log("=".repeat(60));
  console.log("EntryPoint 地址:", ENTRY_POINT_V07);
  
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const beamioAccount = await BeamioAccountFactory.deploy(ENTRY_POINT_V07);
  await beamioAccount.waitForDeployment();
  const accountAddress = await beamioAccount.getAddress();
  
  console.log("✅ BeamioAccount 部署成功!");
  console.log("合约地址:", accountAddress);
  
  deploymentInfo.contracts.beamioAccount = {
    address: accountAddress,
    entryPoint: ENTRY_POINT_V07,
    transactionHash: beamioAccount.deploymentTransaction()?.hash,
    note: "需要调用 initialize() 函数进行初始化"
  };
  
  // 自动验证 Account
  await verifyContract(accountAddress, [ENTRY_POINT_V07], "BeamioAccount");
  
  // ============================================================
  // 保存部署信息
  // ============================================================
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const deploymentFile = path.join(deploymentsDir, `${network.name}-FullSystem.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("\n" + "=".repeat(60));
  console.log("部署完成!");
  console.log("=".repeat(60));
  console.log("\n部署信息已保存到:", deploymentFile);
  
  console.log("\n📋 部署摘要:");
  console.log("  - BeamioOracle:", oracleAddress);
  console.log("  - BeamioQuoteHelperV07:", quoteHelperAddress);
  console.log("  - BeamioAccountDeployer:", deployerAddress);
  console.log("  - BeamioAccount:", accountAddress);
  
  console.log("\n⚠️  重要提示:");
  console.log("  1. BeamioAccount 需要调用 initialize() 函数进行初始化");
  console.log("  2. BeamioAccountDeployer 需要设置 Factory 地址才能使用");
  console.log("  3. BeamioOracle 需要设置初始汇率（USD 和 USDC 已自动设置为 1.0）");
  console.log("  4. 如需部署 BeamioUserCard，需要先部署 BeamioUserCardFactoryPaymasterV07");
  
  console.log("\n📚 下一步:");
  console.log("  - 初始化 BeamioAccount: account.initialize(owner, managers, threshold, factory, module)");
  console.log("  - 设置 AccountDeployer Factory: deployer.setFactory(factoryAddress)");
  console.log("  - 更新 Oracle 汇率: oracle.updateRate(currencyId, rateE18)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
