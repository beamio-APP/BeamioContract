import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { verifyContract } from "./utils/verifyContract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 直接使用 Deployer 部署 BeamioAccount，然后注册到 Factory
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  console.log("=".repeat(60));
  console.log("使用 Deployer 直接部署 BeamioAccount");
  console.log("=".repeat(60));
  console.log("目标 EOA:", TARGET_EOA);
  console.log("部署账户:", signer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "ETH");
  
  const networkInfo = await ethers.provider.getNetwork();
  console.log("网络:", networkInfo.name, "(Chain ID:", networkInfo.chainId.toString() + ")");
  console.log();
  
  // 读取 Factory 和 Deployer 地址（优先使用修复后的 Factory）
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const fixedFactoryFile = path.join(deploymentsDir, `${networkInfo.name}-FactoryAndModule-fixed.json`);
  const factoryFile = path.join(deploymentsDir, `${networkInfo.name}-FactoryAndModule.json`);
  
  let factoryAddress: string;
  let deployerAddress: string;
  
  if (fs.existsSync(fixedFactoryFile)) {
    const deploymentData = JSON.parse(fs.readFileSync(fixedFactoryFile, "utf-8"));
    factoryAddress = deploymentData.contracts.beamioFactoryPaymaster.address;
    deployerAddress = deploymentData.contracts.beamioFactoryPaymaster.deployer;
    console.log("✅ 使用修复后的 Factory:", factoryAddress);
  } else if (fs.existsSync(factoryFile)) {
    const deploymentData = JSON.parse(fs.readFileSync(factoryFile, "utf-8"));
    factoryAddress = deploymentData.contracts.beamioFactoryPaymaster.address;
    deployerAddress = deploymentData.contracts.beamioFactoryPaymaster.deployer;
    console.log("✅ 使用 Factory:", factoryAddress);
  } else {
    throw new Error("未找到 Factory 部署记录");
  }
  
  console.log("Factory 地址:", factoryAddress);
  console.log("Deployer 地址:", deployerAddress);
  console.log();
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  
  // 检查 Deployer 的 Factory 设置
  const deployerFactory = await accountDeployer.factory();
  console.log("Deployer 当前 Factory:", deployerFactory);
  
  if (deployerFactory.toLowerCase() !== factoryAddress.toLowerCase()) {
    console.log("⚠️  Deployer 的 Factory 地址不匹配");
    console.log("   当前:", deployerFactory);
    console.log("   期望:", factoryAddress);
    
    if (deployerFactory === ethers.ZeroAddress) {
      console.log("   尝试设置...");
      try {
        const tx = await accountDeployer.setFactory(factoryAddress);
        await tx.wait();
        console.log("✅ Factory 地址设置成功");
      } catch (error: any) {
        console.error("❌ 设置失败:", error.message);
        throw error;
      }
    } else {
      console.log("⚠️  Deployer 已有 Factory 地址，使用 Deployer 当前的 Factory");
      factoryAddress = deployerFactory; // 使用 Deployer 当前的 Factory
      console.log("   使用 Factory:", factoryAddress);
    }
  }
  
  // 计算 salt 和地址
  const currentIndex = await factory.nextIndexOfCreator(TARGET_EOA);
  const salt = await accountDeployer.computeSalt(TARGET_EOA, currentIndex);
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  
  console.log("当前账户索引:", currentIndex.toString());
  console.log("Salt:", salt);
  
  // 准备 initCode
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (!initCode) {
    throw new Error("无法生成 initCode");
  }
  
  // 计算预期地址
  const initCodeHash = ethers.keccak256(initCode);
  const hash = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes1", "address", "bytes32", "bytes32"],
      ["0xff", deployerAddress, salt, initCodeHash]
    )
  );
  const expectedAddress = ethers.getAddress("0x" + hash.slice(-40));
  
  console.log("预期账户地址:", expectedAddress);
  
  // 检查是否已部署
  const code = await ethers.provider.getCode(expectedAddress);
  const alreadyDeployed = code !== "0x" && code.length > 2;
  console.log("账户是否已部署:", alreadyDeployed);
  
  let accountAddress: string;
  let txHash: string | undefined;
  let needsRegistration = false;
  
  if (alreadyDeployed) {
    const isRegistered = await factory.isBeamioAccount(expectedAddress);
    console.log("是否在 Factory 注册:", isRegistered);
    
    if (isRegistered) {
      console.log("\n✅ 账户已存在并已注册!");
      accountAddress = expectedAddress;
    } else {
      console.log("\n⚠️  账户已部署但未注册，尝试通过 createAccountFor 注册...");
      accountAddress = expectedAddress;
      needsRegistration = true;
    }
  } else {
    // 使用 Factory 部署（需要 Factory 权限）
    console.log("\n" + "=".repeat(60));
    console.log("通过 Factory 部署账户");
    console.log("=".repeat(60));
    
    const isPayMaster = await factory.isPayMaster(signer.address);
    if (!isPayMaster) {
      throw new Error("部署账户不是 Paymaster，无法通过 Factory 部署");
    }
    
    // 尝试使用 Factory 的 deployer.deploy（需要 Factory 调用）
    // 但由于 Factory.getAddress 有问题，我们需要直接调用 Factory 的内部逻辑
    // 实际上，我们可以尝试调用 createAccountFor，但使用静态调用先检查
    
    console.log("尝试调用 Factory.createAccountFor...");
    try {
      // 先尝试静态调用检查
      const staticResult = await factory.createAccountFor.staticCall(TARGET_EOA);
      console.log("静态调用成功，预期地址:", staticResult);
      
      // 实际调用
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
        accountAddress = await factory.beamioAccountOf(TARGET_EOA);
      }
      
      console.log("✅ 账户创建成功!");
      console.log("交易哈希:", receipt?.hash);
      txHash = receipt?.hash;
    } catch (error: any) {
      console.error("❌ Factory.createAccountFor 失败:", error.message);
      throw error;
    }
  }
  
  if (!accountAddress || accountAddress === ethers.ZeroAddress) {
    throw new Error("账户部署失败：未获取到账户地址");
  }
  
  console.log("\n账户地址:", accountAddress);
  
  // 如果需要注册
  if (needsRegistration) {
    console.log("\n尝试通过 createAccountFor 注册现有账户...");
    const isPayMaster = await factory.isPayMaster(signer.address);
    if (isPayMaster) {
      try {
        // Factory.createAccountFor 会检测到账户已部署并自动注册
        const tx = await factory.createAccountFor(TARGET_EOA);
        const receipt = await tx.wait();
        txHash = receipt?.hash;
        console.log("✅ 账户注册成功!");
        console.log("交易哈希:", txHash);
        
        const isRegistered = await factory.isBeamioAccount(accountAddress);
        if (isRegistered) {
          console.log("✅ 账户已在 Factory 注册");
        }
      } catch (error: any) {
        console.log("⚠️  注册失败:", error.message);
        console.log("   账户已部署但可能无法注册到 Factory");
      }
    } else {
      console.log("⚠️  部署账户不是 Paymaster，无法注册");
    }
  }
  
  // 验证合约
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
    salt: salt,
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
