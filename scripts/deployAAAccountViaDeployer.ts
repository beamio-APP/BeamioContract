import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { verifyContract, verifyCreate2Contract } from "./utils/verifyContract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 通过 BeamioAccountDeployer 部署 AA 账号并自动验证
 * 
 * 使用方法:
 * npx hardhat run scripts/deployAAAccountViaDeployer.ts --network base
 * 
 * 环境变量:
 * - DEPLOYER_ADDRESS: BeamioAccountDeployer 合约地址
 * - FACTORY_ADDRESS: Factory 合约地址（可选，如果未设置需要先调用 setFactory）
 * - CREATOR_ADDRESS: 创建者地址（用于计算 salt）
 * - ACCOUNT_INDEX: 账号索引（用于计算 salt，默认 0）
 */
async function main() {
  const { ethers } = await networkModule.connect();
  const [deployer] = await ethers.getSigners();
  
  console.log("部署账户:", deployer.address);
  console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // 配置参数
  const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS || "";
  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "";
  const CREATOR_ADDRESS = process.env.CREATOR_ADDRESS || deployer.address;
  const ACCOUNT_INDEX = parseInt(process.env.ACCOUNT_INDEX || "0");
  
  if (!DEPLOYER_ADDRESS) {
    throw new Error("请设置环境变量 DEPLOYER_ADDRESS (BeamioAccountDeployer 合约地址)");
  }

  // Base 链上的 EntryPoint V0.7 地址
  const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  
  console.log("\n配置信息:");
  console.log("部署器地址:", DEPLOYER_ADDRESS);
  console.log("Factory 地址:", FACTORY_ADDRESS || "未设置");
  console.log("创建者地址:", CREATOR_ADDRESS);
  console.log("账号索引:", ACCOUNT_INDEX);
  console.log("EntryPoint 地址:", ENTRY_POINT_V07);
  
  // 获取部署器合约
  const deployerContract = await ethers.getContractAt("BeamioAccountDeployer", DEPLOYER_ADDRESS);
  
  // 检查并设置 Factory（如果需要）
  const currentFactory = await deployerContract.factory();
  if (currentFactory === ethers.ZeroAddress) {
    if (!FACTORY_ADDRESS) {
      throw new Error("部署器未设置 Factory，请设置环境变量 FACTORY_ADDRESS 或先手动调用 setFactory");
    }
    console.log("\n设置 Factory 地址...");
    const tx = await deployerContract.setFactory(FACTORY_ADDRESS);
    await tx.wait();
    console.log("✅ Factory 设置成功");
  } else {
    console.log("\n当前 Factory 地址:", currentFactory);
    if (FACTORY_ADDRESS && currentFactory.toLowerCase() !== FACTORY_ADDRESS.toLowerCase()) {
      console.log("⚠️  警告: 环境变量中的 Factory 地址与合约中的不一致");
    }
  }
  
  // 计算 salt
  const salt = await deployerContract.computeSalt(CREATOR_ADDRESS, ACCOUNT_INDEX);
  console.log("\n计算的 Salt:", salt);
  
  // 准备初始化代码
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const initCode = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT_V07).data;
  
  if (!initCode) {
    throw new Error("无法生成初始化代码");
  }
  
  // 计算预期地址
  const expectedAddress = await deployerContract.getAddress(salt, initCode);
  console.log("预期部署地址:", expectedAddress);
  
  // 检查是否已经部署
  const code = await ethers.provider.getCode(expectedAddress);
  if (code !== "0x") {
    console.log("⚠️  合约已经部署在地址:", expectedAddress);
    console.log("跳过部署，直接验证...");
    
    // 验证已部署的合约
    await verifyContract(expectedAddress, [ENTRY_POINT_V07], "BeamioAccount");
    
    // 保存部署信息
    await saveDeploymentInfo(expectedAddress, salt, initCode, true, DEPLOYER_ADDRESS);
    return;
  }
  
  // 部署合约（需要 Factory 调用）
  console.log("\n部署 AA 账号...");
  console.log("⚠️  注意: 部署需要通过 Factory 合约调用 deployerContract.deploy()");
  console.log("如果 Factory 未设置，请先设置 Factory");
  
  // 如果当前账户是 Factory，可以直接调用
  const isFactory = currentFactory.toLowerCase() === deployer.address.toLowerCase();
  
  if (isFactory) {
    console.log("当前账户是 Factory，直接部署...");
    const tx = await deployerContract.deploy(salt, initCode);
    const receipt = await tx.wait();
    console.log("✅ 部署成功!");
    console.log("交易哈希:", receipt?.hash);
    
    // 验证部署地址
    const deployedAddress = await deployerContract.getAddress(salt, initCode);
    console.log("实际部署地址:", deployedAddress);
    
    if (deployedAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error("部署地址不匹配!");
    }
    
    // 自动验证合约
    const initCodeHash = ethers.keccak256(initCode);
    await verifyCreate2Contract(
      deployedAddress,
      DEPLOYER_ADDRESS,
      salt,
      initCodeHash,
      [ENTRY_POINT_V07]
    );
    
    // 保存部署信息
    await saveDeploymentInfo(deployedAddress, salt, initCode, false, DEPLOYER_ADDRESS);
  } else {
    console.log("\n⚠️  当前账户不是 Factory，无法直接部署");
    console.log("请使用以下信息通过 Factory 部署:");
    console.log("  Salt:", salt);
    console.log("  InitCode:", initCode);
    console.log("\n或者使用 Factory 账户运行此脚本");
    
    // 保存部署信息（即使未部署）
    await saveDeploymentInfo(expectedAddress, salt, initCode, false, DEPLOYER_ADDRESS);
  }
}

async function saveDeploymentInfo(
  address: string,
  salt: string,
  initCode: string,
  alreadyDeployed: boolean,
  deployerAddress: string
) {
  const { network: networkModule } = await import("hardhat");
  const { ethers } = await networkModule.connect();
  const networkInfo = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();
  const deployerContract = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  
  const deploymentInfo = {
    network: networkInfo.name,
    chainId: networkInfo.chainId.toString(),
    contract: "BeamioAccount",
    address: address,
    deployer: deployerAddress,
    factory: await deployerContract.factory(),
    salt: salt,
    initCodeHash: ethers.keccak256(initCode),
    creator: process.env.CREATOR_ADDRESS || deployer.address,
    accountIndex: parseInt(process.env.ACCOUNT_INDEX || "0"),
    entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    alreadyDeployed: alreadyDeployed,
    timestamp: new Date().toISOString()
  };
  
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const networkName = networkInfo.name;
  const index = process.env.ACCOUNT_INDEX || "0";
  const deploymentFile = path.join(
    deploymentsDir,
    `${networkName}-BeamioAccount-${index}.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("\n部署信息已保存到:", deploymentFile);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
