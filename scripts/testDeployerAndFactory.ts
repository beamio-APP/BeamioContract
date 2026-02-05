import { network as networkModule } from "hardhat";
import { keccak256 } from "ethers";

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  
  console.log("=".repeat(60));
  console.log("测试 Deployer 和 Factory 功能");
  console.log("=".repeat(60));
  console.log("网络:", await ethers.provider.getNetwork().then(n => n.name));
  console.log("调用者:", signer.address);
  console.log();
  
  // 读取部署记录
  const networkInfo = await ethers.provider.getNetwork();
  const networkName = networkInfo.name;
  const deploymentFile = `deployments/${networkName}-FactoryAndModule.json`;
  
  let factoryAddress: string;
  try {
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const { default: pathModule } = path;
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = pathModule.dirname(__filename);
    
    const deploymentPath = pathModule.join(__dirname, "..", deploymentFile);
    if (fs.existsSync(deploymentPath)) {
      const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
      factoryAddress = deploymentData.contracts.beamioFactoryPaymaster.address;
      console.log("✅ 从部署记录读取 Factory 地址:", factoryAddress);
    } else {
      throw new Error(`部署记录文件不存在: ${deploymentPath}`);
    }
  } catch (error: any) {
    console.error("❌ 读取部署记录失败:", error.message);
    process.exit(1);
  }
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const deployerAddress = await factory.deployer();
  console.log("Deployer 地址:", deployerAddress);
  console.log();
  
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  
  // 测试参数
  const TEST_EOA = signer.address; // 使用调用者地址作为测试 EOA
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (!initCode) {
    throw new Error("无法生成 initCode");
  }
  
  console.log("=".repeat(60));
  console.log("测试 1: Deployer.computeSalt");
  console.log("=".repeat(60));
  for (let i = 0; i <= 2; i++) {
    const salt = await accountDeployer.computeSalt(TEST_EOA, i);
    console.log(`Index ${i}:`, salt);
  }
  console.log();
  
  console.log("=".repeat(60));
  console.log("测试 2: Deployer.getAddress");
  console.log("=".repeat(60));
  console.log("InitCode 长度:", initCode.length);
  console.log("InitCode Hash:", keccak256(initCode));
  console.log();
  
  for (let i = 0; i <= 2; i++) {
    const salt = await accountDeployer.computeSalt(TEST_EOA, i);
    
    // 调用 Deployer.getAddress
    const deployerComputedAddress = await accountDeployer.getAddress(salt, initCode);
    
    // 手动计算地址
    const initCodeHash = keccak256(initCode);
    const manualHash = keccak256(
      ethers.solidityPacked(
        ["bytes1", "address", "bytes32", "bytes32"],
        ["0xff", deployerAddress, salt, initCodeHash]
      )
    );
    const manualAddress = ethers.getAddress("0x" + manualHash.slice(-40));
    
    console.log(`Index ${i}:`);
    console.log("  Salt:", salt);
    console.log("  Deployer.getAddress():", deployerComputedAddress);
    console.log("  手动计算地址:", manualAddress);
    console.log("  是否一致:", deployerComputedAddress.toLowerCase() === manualAddress.toLowerCase());
    
    if (deployerComputedAddress.toLowerCase() !== manualAddress.toLowerCase()) {
      console.log("  ❌ 地址不一致！Deployer.getAddress 可能有问题");
    } else {
      console.log("  ✅ 地址一致");
    }
    
    // 检查地址上的代码
    const code = await ethers.provider.getCode(deployerComputedAddress);
    const hasCode = code !== "0x" && code.length > 2;
    console.log("  地址是否有代码:", hasCode);
    if (hasCode) {
      console.log("  代码长度:", code.length);
    }
    console.log();
  }
  
  console.log("=".repeat(60));
  console.log("测试 3: Factory.getAddress");
  console.log("=".repeat(60));
  for (let i = 0; i <= 2; i++) {
    const factoryComputedAddress = await factory.getAddress(TEST_EOA, i);
    console.log(`Index ${i}:`, factoryComputedAddress);
    
    // 检查是否返回了 Factory 地址
    if (factoryComputedAddress.toLowerCase() === factoryAddress.toLowerCase()) {
      console.log("  ❌ 返回了 Factory 地址，这是错误的！");
    } else {
      console.log("  ✅ 返回了非 Factory 地址");
    }
    
    // 检查是否返回了 Deployer 地址
    if (factoryComputedAddress.toLowerCase() === deployerAddress.toLowerCase()) {
      console.log("  ❌ 返回了 Deployer 地址，这是错误的！");
    }
    
    // 手动计算应该的地址
    const salt = await accountDeployer.computeSalt(TEST_EOA, i);
    const initCodeHash = keccak256(initCode);
    const manualHash = keccak256(
      ethers.solidityPacked(
        ["bytes1", "address", "bytes32", "bytes32"],
        ["0xff", deployerAddress, salt, initCodeHash]
      )
    );
    const manualAddress = ethers.getAddress("0x" + manualHash.slice(-40));
    
    if (factoryComputedAddress.toLowerCase() === manualAddress.toLowerCase()) {
      console.log("  ✅ 与手动计算的地址一致");
    } else {
      console.log("  ❌ 与手动计算的地址不一致");
      console.log("  手动计算地址:", manualAddress);
    }
    console.log();
  }
  
  console.log("=".repeat(60));
  console.log("测试 4: 检查 Deployer 合约代码");
  console.log("=".repeat(60));
  const deployerCode = await ethers.provider.getCode(deployerAddress);
  console.log("Deployer 代码长度:", deployerCode.length);
  
  // 尝试调用 Deployer 的其他方法
  try {
    const deployerFactory = await accountDeployer.factory();
    console.log("Deployer.factory():", deployerFactory);
    if (deployerFactory.toLowerCase() === factoryAddress.toLowerCase()) {
      console.log("  ✅ Factory 地址设置正确");
    } else {
      console.log("  ⚠️  Factory 地址设置不正确");
    }
  } catch (error: any) {
    console.log("  ❌ 调用 factory() 失败:", error.message);
  }
  
  console.log();
  console.log("=".repeat(60));
  console.log("测试完成");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
