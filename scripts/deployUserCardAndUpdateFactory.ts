import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { verifyContract } from "./utils/verifyContract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 部署 BeamioUserCard 并自动更新 Factory
 * 
 * 这个脚本解决了循环依赖问题：
 * 1. 先部署 Factory（使用占位符 UserCard）
 * 2. 部署真正的 UserCard（使用 Factory 作为 gateway）
 * 3. 自动更新 Factory 的 UserCard 地址
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const [deployer] = await ethers.getSigners();
  
  console.log("=".repeat(60));
  console.log("部署 BeamioUserCard 并自动更新 Factory");
  console.log("=".repeat(60));
  console.log("部署账户:", deployer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  
  const networkInfo = await ethers.provider.getNetwork();
  console.log("网络:", networkInfo.name, "(Chain ID:", networkInfo.chainId.toString() + ")");
  
  // 从环境变量或部署记录获取 Factory 地址
  let FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "";
  
  if (!FACTORY_ADDRESS) {
    // 尝试从部署记录文件读取（优先 FullAccountAndUserCard）
    const deploymentsDir = path.join(__dirname, "..", "deployments");
    try {
      const fullFile = path.join(deploymentsDir, `${networkInfo.name}-FullAccountAndUserCard.json`);
      if (fs.existsSync(fullFile)) {
        const data = JSON.parse(fs.readFileSync(fullFile, "utf-8"));
        const addr = data.contracts?.beamioFactoryPaymaster?.address;
        if (addr) {
          FACTORY_ADDRESS = addr;
          console.log("✅ 从 FullAccountAndUserCard 读取 AA Factory 地址:", FACTORY_ADDRESS);
        }
      }
      if (!FACTORY_ADDRESS) {
        const factoryFile = path.join(deploymentsDir, `${networkInfo.name}-FactoryAndModule.json`);
        if (fs.existsSync(factoryFile)) {
          const factoryData = JSON.parse(fs.readFileSync(factoryFile, "utf-8"));
          if (factoryData.contracts?.beamioFactoryPaymaster?.address) {
            FACTORY_ADDRESS = factoryData.contracts.beamioFactoryPaymaster.address;
            console.log("✅ 从 FactoryAndModule 读取 Factory 地址:", FACTORY_ADDRESS);
          }
        }
      }
    } catch (error) {
      // 忽略错误
    }
  }
  
  if (!FACTORY_ADDRESS) {
    console.log("❌ 错误: 未设置 FACTORY_ADDRESS");
    console.log("请在 .env 文件中设置 FACTORY_ADDRESS 环境变量");
    console.log("或确保已运行部署脚本: npm run deploy:factory:base");
    return;
  }
  
  // UserCard 部署参数（从环境变量获取，或使用默认值）
  const USER_CARD_URI = process.env.USER_CARD_URI || "https://api.beamio.io/metadata/{id}.json";
  const USER_CARD_CURRENCY = parseInt(process.env.USER_CARD_CURRENCY || "4"); // 4 = USDC
  const USER_CARD_PRICE = process.env.USER_CARD_PRICE || "1000000"; // pointsUnitPriceInCurrencyE6，1 USDC = 1e6 pts
  const USER_CARD_OWNER = process.env.USER_CARD_OWNER || deployer.address;
  
  console.log("\n配置参数:");
  console.log("  Factory:", FACTORY_ADDRESS);
  console.log("  URI:", USER_CARD_URI);
  console.log("  Currency:", USER_CARD_CURRENCY, "(4=USDC)");
  console.log("  Price:", USER_CARD_PRICE);
  console.log("  Owner:", USER_CARD_OWNER);
  
  // 验证 Factory 地址
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", FACTORY_ADDRESS);
  const factoryAdmin = await factory.admin();
  
  if (factoryAdmin.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log("\n❌ 错误: 部署账户不是 Factory 的 admin");
    console.log("  Factory Admin:", factoryAdmin);
    console.log("  部署账户:", deployer.address);
    console.log("\n💡 解决方案:");
    console.log("  1. 使用 Factory admin 账户部署 UserCard");
    console.log("  2. 或先调用 factory.transferAdmin(newAdmin) 转移 admin 权限");
    return;
  }
  
  // ============================================================
  // 1. 部署 BeamioUserCard
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 1: 部署 BeamioUserCard");
  console.log("=".repeat(60));
  
  const BeamioUserCardFactory = await ethers.getContractFactory("BeamioUserCard");
  const userCard = await BeamioUserCardFactory.deploy(
    USER_CARD_URI,
    USER_CARD_CURRENCY,
    USER_CARD_PRICE,
    USER_CARD_OWNER,
    FACTORY_ADDRESS // gateway = Factory
  );
  
  await userCard.waitForDeployment();
  const userCardAddress = await userCard.getAddress();
  
  console.log("✅ BeamioUserCard 部署成功!");
  console.log("合约地址:", userCardAddress);
  
  // 等待区块确认
  console.log("等待区块确认...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // ============================================================
  // 2. 自动更新 Factory 的 UserCard 地址
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 2: 自动更新 Factory 的 UserCard 地址");
  console.log("=".repeat(60));
  
  const currentUserCard = await factory.beamioUserCard();
  console.log("当前 Factory UserCard 地址:", currentUserCard);
  console.log("新的 UserCard 地址:", userCardAddress);
  
  if (currentUserCard.toLowerCase() === userCardAddress.toLowerCase()) {
    console.log("✅ Factory 已经使用正确的 UserCard 地址");
  } else {
    console.log("更新 Factory UserCard 地址...");
    const tx = await factory.setUserCard(userCardAddress);
    await tx.wait();
    console.log("✅ Factory UserCard 地址已更新!");
    console.log("交易哈希:", tx.hash);
  }
  
  // ============================================================
  // 3. 验证合约
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 3: 验证合约");
  console.log("=".repeat(60));
  
  await verifyContract(
    userCardAddress,
    [
      USER_CARD_URI,
      USER_CARD_CURRENCY,
      USER_CARD_PRICE,
      USER_CARD_OWNER,
      FACTORY_ADDRESS
    ],
    "BeamioUserCard"
  );
  
  // ============================================================
  // 保存部署信息
  // ============================================================
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const deploymentInfo = {
    network: networkInfo.name,
    chainId: networkInfo.chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    factory: FACTORY_ADDRESS,
    userCard: {
      address: userCardAddress,
      uri: USER_CARD_URI,
      currency: USER_CARD_CURRENCY,
      price: USER_CARD_PRICE,
      owner: USER_CARD_OWNER,
      gateway: FACTORY_ADDRESS,
      transactionHash: userCard.deploymentTransaction()?.hash
    }
  };
  
  const deploymentFile = path.join(deploymentsDir, `${networkInfo.name}-UserCard.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("\n" + "=".repeat(60));
  console.log("部署完成!");
  console.log("=".repeat(60));
  console.log("\n部署信息已保存到:", deploymentFile);
  
  console.log("\n📋 部署摘要:");
  console.log("  - BeamioUserCard:", userCardAddress);
  console.log("  - Factory:", FACTORY_ADDRESS);
  console.log("  - Factory UserCard 地址已自动更新");
  
  // ============================================================
  // 4. 合格性检查：验证 getRedeemStatus 返回 (bool, uint256 totalPoints6)
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤 4: 合格性检查");
  console.log("=".repeat(60));
  const card = await ethers.getContractAt("BeamioUserCard", userCardAddress);
  const testHash = ethers.keccak256(ethers.toUtf8Bytes("_verification_"));
  const [active, totalPoints6] = await card.getRedeemStatus(testHash);
  console.log("getRedeemStatus(0x...): active =", active, ", totalPoints6 =", totalPoints6.toString());
  if (typeof totalPoints6 === "bigint") {
    console.log("✅ getRedeemStatus 返回 uint256 totalPoints6，新接口合格");
  } else {
    console.log("⚠️  totalPoints6 类型异常:", typeof totalPoints6);
  }
  const [activeBatch, totalBatch] = await card["getRedeemStatusBatch(bytes32[])"]([testHash]);
  if (Array.isArray(totalBatch) && totalBatch.length === 1) {
    console.log("✅ getRedeemStatusBatch 返回 uint256[] totalPoints6，批量接口合格");
  }

  console.log("\n✅ 完成!");
  console.log("  Factory 现在使用真正的 UserCard 地址");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
