import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 检查 BeamioUserCard 合约状态
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const networkInfo = await ethers.provider.getNetwork();
  
  // 从部署记录读取 UserCard 地址
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFile = path.join(deploymentsDir, `base-UserCard-0xEaBF0A98.json`);
  
  let userCardAddress: string;
  let eoa: string;
  let factoryFromFile: string | undefined;
  
  if (fs.existsSync(deploymentFile)) {
    const deploymentData = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
    userCardAddress = deploymentData.userCard;
    eoa = deploymentData.eoa;
    factoryFromFile = deploymentData.factory;
    console.log("从部署记录读取:");
    console.log("  UserCard:", userCardAddress);
    console.log("  EOA:", eoa);
    if (factoryFromFile) console.log("  Factory:", factoryFromFile);
  } else {
    // 如果没有部署记录，使用环境变量或命令行参数
    userCardAddress = process.env.USER_CARD_ADDRESS || "";
    eoa = process.env.TARGET_EOA || "";
    
    if (!userCardAddress) {
      throw new Error("未找到 UserCard 地址，请设置 USER_CARD_ADDRESS 环境变量");
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("检查 BeamioUserCard");
  console.log("=".repeat(60));
  console.log("网络:", networkInfo.name, "(Chain ID:", networkInfo.chainId.toString() + ")");
  console.log("UserCard 地址:", userCardAddress);
  console.log("EOA:", eoa);
  console.log();
  
  // 检查合约代码
  const code = await ethers.provider.getCode(userCardAddress);
  if (code === "0x") {
    throw new Error(`地址 ${userCardAddress} 没有合约代码`);
  }
  console.log("✅ 合约代码存在");
  console.log("代码长度:", code.length, "字符");
  console.log();
  
  // 获取 UserCard 合约实例
  const userCard = await ethers.getContractAt("BeamioUserCard", userCardAddress);
  
  // 检查基本配置
  console.log("=".repeat(60));
  console.log("基本配置");
  console.log("=".repeat(60));
  
  const owner = await userCard.owner();
  console.log("Owner:", owner);
  console.log("预期 Owner (EOA):", eoa);
  console.log("Owner 匹配:", owner.toLowerCase() === eoa.toLowerCase() ? "✅" : "❌");
  console.log();
  
  const gateway = await userCard.factoryGateway();
  console.log("Gateway (Factory):", gateway);
  
  const factoryAddress = process.env.USER_CARD_FACTORY_ADDRESS || factoryFromFile || "0xe8EBf6bbdfe151b2D6A4F3417072C4942e227960";
  console.log("预期 Factory:", factoryAddress);
  console.log("Gateway 匹配:", gateway.toLowerCase() === factoryAddress.toLowerCase() ? "✅" : "❌");
  console.log();
  
  const currency = await userCard.currency();
  const currencyLabel = currency === 0n ? "CAD" : currency === 4n ? "USDC" : `enum ${currency}`;
  console.log("Currency:", currency.toString(), `(${currencyLabel})`);
  console.log();
  
  const priceE6 = await userCard.pointsUnitPriceInCurrencyE6();
  console.log("Points Unit Price (E6):", priceE6.toString());
  console.log("预期 Price: 1000000 (1 CAD = 1 token)");
  console.log("Price 匹配:", priceE6 === 1000000n ? "✅" : "❌");
  console.log();
  
  const uri = await userCard.uri(0);
  console.log("URI:", uri);
  console.log();
  
  // 检查 Factory 注册状态
  console.log("=".repeat(60));
  console.log("Factory 注册状态");
  console.log("=".repeat(60));
  
  const factory = await ethers.getContractAt("BeamioUserCardFactoryPaymasterV07", factoryAddress);
  
  const isRegistered = await factory.isBeamioUserCard(userCardAddress);
  console.log("是否在 Factory 注册:", isRegistered ? "✅ 是" : "❌ 否");
  console.log();
  
  const cardOwner = await factory.beamioUserCardOwner(userCardAddress);
  console.log("Factory 记录的 Owner:", cardOwner);
  console.log("Owner 匹配:", cardOwner.toLowerCase() === eoa.toLowerCase() ? "✅" : "❌");
  console.log();
  
  const cardsOfOwner = await factory.cardsOfOwner(eoa);
  console.log("EOA 的 UserCard 数量:", cardsOfOwner.length);
  console.log("UserCard 列表:");
  for (let i = 0; i < cardsOfOwner.length; i++) {
    const card = cardsOfOwner[i];
    const isReg = await factory.isBeamioUserCard(card);
    const marker = card.toLowerCase() === userCardAddress.toLowerCase() ? " ← 当前检查的合约" : "";
    console.log(`  ${i + 1}. ${card} (已注册: ${isReg})${marker}`);
  }
  console.log();
  
  // 检查其他配置
  console.log("=".repeat(60));
  console.log("其他配置");
  console.log("=".repeat(60));
  
  const deployer = await userCard.deployer();
  console.log("Deployer:", deployer);
  console.log();
  
  const version = await userCard.VERSION();
  console.log("Version:", version.toString());
  console.log();
  
  const pointsId = await userCard.POINTS_ID();
  console.log("Points ID:", pointsId.toString());
  console.log();
  
  const nftStartId = await userCard.NFT_START_ID();
  console.log("NFT Start ID:", nftStartId.toString());
  console.log();
  
  const threshold = await userCard.threshold();
  console.log("Multisig Threshold:", threshold.toString());
  console.log();
  
  // 检查 Admin 状态
  const ownerIsAdmin = await userCard.isAdmin(owner);
  console.log("Owner 是否为 Admin:", ownerIsAdmin ? "✅ 是" : "❌ 否");
  console.log();
  
  // 检查 Redeem Module
  try {
    const redeemModule = await factory.defaultRedeemModule();
    console.log("Default Redeem Module:", redeemModule);
    
    const moduleCode = await ethers.provider.getCode(redeemModule);
    console.log("Redeem Module 代码存在:", moduleCode !== "0x" ? "✅" : "❌");
  } catch (error: any) {
    console.log("⚠️  无法获取 Redeem Module:", error.message);
  }
  console.log();
  
  // 总结
  console.log("=".repeat(60));
  console.log("检查总结");
  console.log("=".repeat(60));
  
  const checks = [
    { name: "合约代码存在", passed: code !== "0x" },
    { name: "Owner 正确", passed: owner.toLowerCase() === eoa.toLowerCase() },
    { name: "Gateway 正确", passed: gateway.toLowerCase() === factoryAddress.toLowerCase() },
    { name: "Currency 有效 (0=CAD,4=USDC)", passed: currency === 0n || currency === 4n },
    { name: "Price 正确 (1e6 = 1 CAD/token)", passed: priceE6 === 1000000n },
    { name: "在 Factory 注册", passed: isRegistered },
    { name: "Factory Owner 记录正确", passed: cardOwner.toLowerCase() === eoa.toLowerCase() },
  ];
  
  let allPassed = true;
  for (const check of checks) {
    const status = check.passed ? "✅" : "❌";
    console.log(`${status} ${check.name}`);
    if (!check.passed) allPassed = false;
  }
  
  console.log();
  if (allPassed) {
    console.log("✅ 所有检查通过！UserCard 配置正确。");
  } else {
    console.log("❌ 部分检查未通过，请检查上述问题。");
  }
  
  // 区块浏览器链接
  const explorerBase = networkInfo.chainId === 8453n 
    ? "https://basescan.org"
    : networkInfo.chainId === 84532n
    ? "https://sepolia.basescan.org"
    : "";
  
  if (explorerBase) {
    console.log("\n" + "=".repeat(60));
    console.log("区块浏览器链接");
    console.log("=".repeat(60));
    console.log("UserCard:", `${explorerBase}/address/${userCardAddress}`);
    console.log("Factory:", `${explorerBase}/address/${factoryAddress}`);
    console.log("EOA:", `${explorerBase}/address/${eoa}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
