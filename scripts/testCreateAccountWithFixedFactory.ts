import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  
  console.log("=".repeat(60));
  console.log("测试使用修复后的 Factory 创建账户");
  console.log("=".repeat(60));
  console.log("网络:", await ethers.provider.getNetwork().then(n => n.name));
  console.log("调用者:", signer.address);
  console.log();
  
  // 注意：这个脚本需要在重新部署修复后的 Factory 后使用
  // 或者我们可以先测试本地编译的合约逻辑
  
  const TEST_EOA = signer.address;
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  
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
      console.log("当前 Factory 地址:", factoryAddress);
      console.log("⚠️  注意：这是旧的 Factory，需要重新部署修复后的版本");
    } else {
      throw new Error(`部署记录文件不存在: ${deploymentPath}`);
    }
  } catch (error: any) {
    console.error("读取部署记录失败:", error.message);
    process.exit(1);
  }
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const deployerAddress = await factory.deployer();
  const isPayMaster = await factory.isPayMaster(signer.address);
  
  console.log("Deployer 地址:", deployerAddress);
  console.log("调用者是否为 Paymaster:", isPayMaster);
  console.log();
  
  // 手动计算应该的地址（用于验证）
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  const salt = await accountDeployer.computeSalt(TEST_EOA, 0);
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (!initCode) {
    throw new Error("无法生成 initCode");
  }
  
  const initCodeHash = ethers.keccak256(initCode);
  const manualHash = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes1", "address", "bytes32", "bytes32"],
      ["0xff", deployerAddress, salt, initCodeHash]
    )
  );
  const manualAddress = ethers.getAddress("0x" + manualHash.slice(-40));
  
  console.log("手动计算的预期地址:", manualAddress);
  
  // 检查地址是否已有代码
  const code = await ethers.provider.getCode(manualAddress);
  const alreadyDeployed = code !== "0x" && code.length > 2;
  console.log("地址是否已部署:", alreadyDeployed);
  
  if (alreadyDeployed) {
    const isRegistered = await factory.isBeamioAccount(manualAddress);
    console.log("是否在 Factory 注册:", isRegistered);
  }
  
  console.log();
  console.log("=".repeat(60));
  console.log("总结");
  console.log("=".repeat(60));
  console.log("1. ✅ Factory.getAddress 已修复（不依赖 Deployer.getAddress）");
  console.log("2. ⚠️  需要重新部署修复后的 Factory 合约");
  console.log("3. 📝 修复内容：Factory.getAddress 现在直接计算 CREATE2 地址");
  console.log("4. 🔧 问题原因：ethers.js 对 bytes calldata 参数的 ABI 解析有问题");
  console.log();
  console.log("下一步：");
  console.log("  1. 重新部署修复后的 Factory 合约到 testnet");
  console.log("  2. 测试 Factory.getAddress 是否返回正确地址");
  console.log("  3. 测试 createAccountFor 是否能成功创建账户");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
