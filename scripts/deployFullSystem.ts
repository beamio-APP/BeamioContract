import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { verifyContract } from "./utils/verifyContract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 完整系统部署脚本
 *
 * BeamioOracle 与 BeamioQuoteHelperV07 禁止重新部署，仅从 EXISTING_* 或 base-FullAccountAndUserCard.json 读取已有地址。
 *
 * 部署/使用顺序：
 * 1. BeamioOracle - 仅使用已有地址（禁止部署）
 * 2. BeamioQuoteHelperV07 - 仅使用已有地址（禁止部署）
 * 3. BeamioAccountDeployer - CREATE2 部署器
 * 4. BeamioAccount - AA 账号合约（可选）
 *
 * 注意：BeamioUserCard / BeamioUserCardFactoryPaymasterV07 通过其他脚本部署。
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const [deployer] = await ethers.getSigners();
  
  console.log("=".repeat(60));
  console.log("完整系统部署脚本");
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
  const deploymentsDir = path.join(__dirname, "..", "deployments");

  // ============================================================
  // 1. BeamioOracle（禁止重新部署，仅使用已有地址）
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 1: BeamioOracle（仅使用已有地址，禁止重新部署）");
  console.log("=".repeat(60));

  let oracleAddress = process.env.EXISTING_ORACLE_ADDRESS || "";
  if (!oracleAddress && fs.existsSync(path.join(deploymentsDir, `${networkInfo.name}-FullAccountAndUserCard.json`))) {
    const data = JSON.parse(fs.readFileSync(path.join(deploymentsDir, `${networkInfo.name}-FullAccountAndUserCard.json`), "utf-8");
    oracleAddress = data.existing?.beamioOracle || "";
  }
  if (!oracleAddress) {
    throw new Error(
      "BeamioOracle 禁止重新部署。请设置 EXISTING_ORACLE_ADDRESS 或确保 deployments/base-FullAccountAndUserCard.json 含 existing.beamioOracle。"
    );
  }
  const codeOracle = await ethers.provider.getCode(oracleAddress);
  if (codeOracle === "0x") {
    throw new Error(`Oracle 地址 ${oracleAddress} 没有合约代码`);
  }
  console.log("✅ 使用现有 BeamioOracle:", oracleAddress);
  deploymentInfo.contracts.beamioOracle = { address: oracleAddress, note: "禁止重新部署，使用已有合约" };

  // ============================================================
  // 2. BeamioQuoteHelperV07（禁止重新部署，仅使用已有地址）
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 2: BeamioQuoteHelperV07（仅使用已有地址，禁止重新部署）");
  console.log("=".repeat(60));

  let quoteHelperAddress = process.env.EXISTING_QUOTE_HELPER_ADDRESS || "";
  if (!quoteHelperAddress && fs.existsSync(path.join(deploymentsDir, `${networkInfo.name}-FullAccountAndUserCard.json`))) {
    const data = JSON.parse(fs.readFileSync(path.join(deploymentsDir, `${networkInfo.name}-FullAccountAndUserCard.json`), "utf-8");
    quoteHelperAddress = data.existing?.beamioQuoteHelper || "";
  }
  if (!quoteHelperAddress) {
    throw new Error(
      "BeamioQuoteHelperV07 禁止重新部署。请设置 EXISTING_QUOTE_HELPER_ADDRESS 或确保 deployments/base-FullAccountAndUserCard.json 含 existing.beamioQuoteHelper。"
    );
  }
  const codeQH = await ethers.provider.getCode(quoteHelperAddress);
  if (codeQH === "0x") {
    throw new Error(`QuoteHelper 地址 ${quoteHelperAddress} 没有合约代码`);
  }
  console.log("✅ 使用现有 BeamioQuoteHelperV07:", quoteHelperAddress);
  deploymentInfo.contracts.beamioQuoteHelper = { address: quoteHelperAddress, oracle: oracleAddress, note: "禁止重新部署，使用已有合约" };
  
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
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const deploymentFile = path.join(deploymentsDir, `${networkInfo.name}-FullSystem.json`);
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
