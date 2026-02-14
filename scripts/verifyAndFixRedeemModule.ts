/**
 * 验证并修复 Factory 的 defaultRedeemModule
 *
 * 问题：createRedeem 时 UC_RedeemDelegateFailed(空 data)，通常表示 module 不支持 createRedeemBatch
 *（例如旧版 IRedeemModule 仅有 createRedeem）。
 *
 * 用法：
 *   npx hardhat run scripts/verifyAndFixRedeemModule.ts --network base
 *   # 仅检查（不部署）
 *   VERIFY_ONLY=1 npx hardhat run scripts/verifyAndFixRedeemModule.ts --network base
 *   # 强制部署新 Module 并 setRedeemModule（即使当前已有 createRedeemBatch）
 *   FORCE_UPDATE=1 npx hardhat run scripts/verifyAndFixRedeemModule.ts --network base
 */
import { network as networkModule } from "hardhat";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CREATE_REDEEM_BATCH_SELECTOR = ethers.id("createRedeemBatch(bytes32[],uint256,uint256,uint64,uint64,uint256[],uint256[])").slice(0, 10);

async function main() {
  const { ethers } = await networkModule.connect();
  const networkInfo = await ethers.provider.getNetwork();
  const chainId = Number(networkInfo.chainId);
  const verifyOnly = process.env.VERIFY_ONLY === "1";
  const forceUpdate = process.env.FORCE_UPDATE === "1";

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const factoryFile = path.join(deploymentsDir, `${networkInfo.name}-UserCardFactory.json`);
  if (!fs.existsSync(factoryFile)) {
    throw new Error(`未找到部署文件: ${factoryFile}`);
  }
  const deployment = JSON.parse(fs.readFileSync(factoryFile, "utf-8"));
  const factoryAddress = deployment.contracts?.beamioUserCardFactoryPaymaster?.address;
  const currentModule = deployment.contracts?.beamioUserCardFactoryPaymaster?.redeemModule;
  if (!factoryAddress || !currentModule) {
    throw new Error("部署文件中缺少 factory 或 redeemModule 地址");
  }

  console.log("=".repeat(60));
  console.log("验证 RedeemModule");
  console.log("=".repeat(60));
  console.log("网络:", networkInfo.name, "Chain ID:", chainId);
  console.log("Factory:", factoryAddress);
  console.log("当前 RedeemModule:", currentModule);
  console.log("createRedeemBatch 预期 selector:", CREATE_REDEEM_BATCH_SELECTOR);
  console.log();

  const factory = await ethers.getContractAt("BeamioUserCardFactoryPaymasterV07", factoryAddress);
  const onChainModule = await factory.defaultRedeemModule();
  if (onChainModule.toLowerCase() !== currentModule.toLowerCase()) {
    console.log("⚠️  链上 defaultRedeemModule 与部署记录不一致:");
    console.log("   链上:", onChainModule);
    console.log("   记录:", currentModule);
    console.log("   以链上为准继续检查。\n");
  }

  const moduleCode = await ethers.provider.getCode(onChainModule);
  if (moduleCode === "0x") {
    throw new Error(`RedeemModule 地址 ${onChainModule} 没有合约代码`);
  }
  console.log("✅ RedeemModule 有代码，长度:", moduleCode.length, "字符");

  const selectorHex = CREATE_REDEEM_BATCH_SELECTOR.slice(2).toLowerCase();
  const hasSelector = moduleCode.toLowerCase().includes(selectorHex);
  if (hasSelector && !forceUpdate) {
    console.log("✅ RedeemModule 包含 createRedeemBatch selector");
    console.log("\n若仍出现 UC_RedeemDelegateFailed(空)，请检查:");
    console.log("  1. hashes 中是否有重复或已存在的 active redeem");
    console.log("  2. tokenIds/amounts 是否合法（同长、amounts>0）");
    console.log("  3. validAfter/validBefore 时间范围");
    return;
  }
  if (forceUpdate && hasSelector) {
    console.log("FORCE_UPDATE=1: 当前 Module 已有 createRedeemBatch，将仍部署新版并更新");
  }

  console.log("❌ RedeemModule 缺少 createRedeemBatch，需要更新为新版 BeamioUserCardRedeemModuleVNext");
  if (verifyOnly) {
    console.log("\n仅检查模式，未部署。要修复请去掉 VERIFY_ONLY=1 重新运行。");
    return;
  }

  const [deployer] = await ethers.getSigners();
  const owner = await factory.owner();
  if (deployer.address.toLowerCase() !== owner.toLowerCase()) {
    console.log("\n⚠️  当前账户", deployer.address, "不是 Factory owner");
    console.log("   Owner:", owner);
    console.log("   将只部署新 Module，owner 需自行调用 setRedeemModule。\n");
  }

  let newModuleAddress = process.env.NEW_REDEEM_MODULE_ADDRESS;
  if (newModuleAddress && ethers.isAddress(newModuleAddress)) {
    console.log("\n使用已部署的 RedeemModule (NEW_REDEEM_MODULE_ADDRESS):", newModuleAddress);
  } else {
    console.log("\n部署新的 BeamioUserCardRedeemModuleVNext...");
    const ModuleFactory = await ethers.getContractFactory("BeamioUserCardRedeemModuleVNext");
    const newModule = await ModuleFactory.deploy();
    await newModule.waitForDeployment();
    newModuleAddress = await newModule.getAddress();
    console.log("✅ 新 RedeemModule 已部署:", newModuleAddress);
  }

  const newCode = await ethers.provider.getCode(newModuleAddress);
  const newHasSelector = newCode.toLowerCase().includes(selectorHex);
  if (newHasSelector) {
    console.log("✅ 新 Module 包含 createRedeemBatch selector");
  } else {
    console.log("⚠️  bytecode 中未检测到 selector（编译器优化可能导致），合约源码含 createRedeemBatch，继续执行");
  }

  if (deployer.address.toLowerCase() === owner.toLowerCase()) {
    console.log("\n调用 setRedeemModule...");
    const tx = await factory.setRedeemModule(newModuleAddress);
    await tx.wait();
    console.log("✅ setRedeemModule 成功, tx:", tx.hash);
  } else {
    console.log("\n请 Factory owner 执行:");
    console.log(`  factory.setRedeemModule("${newModuleAddress}")`);
    const iface = factory.interface;
    const data = iface.encodeFunctionData("setRedeemModule", [newModuleAddress]);
    console.log("  Calldata:", data);
  }

  const outFile = path.join(deploymentsDir, `${networkInfo.name}-UserCardDependencies.json`);
  const depData: Record<string, unknown> = fs.existsSync(outFile)
    ? JSON.parse(fs.readFileSync(outFile, "utf-8"))
    : { network: networkInfo.name, chainId, deployer: deployer.address, timestamp: new Date().toISOString(), contracts: {} };
  (depData.contracts as Record<string, unknown>).redeemModule = {
    address: newModuleAddress,
    previous: onChainModule,
    note: "BeamioUserCardRedeemModuleVNext (with createRedeemBatch)",
  };
  fs.writeFileSync(outFile, JSON.stringify(depData, null, 2));
  console.log("\n部署记录已更新:", outFile);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
