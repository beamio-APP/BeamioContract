import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  
  console.log("=".repeat(60));
  console.log("测试修复后的 Factory.getAddress");
  console.log("=".repeat(60));
  
  // 注意：这个脚本需要在重新部署 Factory 后使用
  // 或者我们可以先测试本地编译的合约
  
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
      console.log("Factory 地址:", factoryAddress);
    } else {
      throw new Error(`部署记录文件不存在: ${deploymentPath}`);
    }
  } catch (error: any) {
    console.error("读取部署记录失败:", error.message);
    process.exit(1);
  }
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const deployerAddress = await factory.deployer();
  console.log("Deployer 地址:", deployerAddress);
  
  // 手动计算应该的地址
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
  
  console.log("\n手动计算的地址:", manualAddress);
  
  // 测试 Factory.getAddress
  console.log("\n测试 Factory.getAddress():");
  for (let i = 0; i <= 2; i++) {
    const factoryAddress_result = await factory.getAddress(TEST_EOA, i);
    console.log(`Index ${i}:`, factoryAddress_result);
    
    if (factoryAddress_result.toLowerCase() === factoryAddress.toLowerCase()) {
      console.log("  ❌ 返回了 Factory 地址");
    } else if (factoryAddress_result.toLowerCase() === deployerAddress.toLowerCase()) {
      console.log("  ❌ 返回了 Deployer 地址");
    } else {
      console.log("  ✅ 返回了非 Factory/Deployer 地址");
    }
  }
  
  console.log("\n注意：如果 Factory 还没有重新部署，getAddress 可能仍然返回错误地址");
  console.log("需要重新部署修复后的 Factory 合约");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
