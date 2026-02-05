import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0x17DB55F18e004Ea96F4D8362f5496749a423A63c";
  const deployerAddress = "0x9f2f6c16C5ec6F0dF3b733A38943A1697d4CAC07";
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  console.log("测试 Deployer.deploy 调用...");
  console.log("Factory:", factoryAddress);
  console.log("Deployer:", deployerAddress);
  console.log("目标 EOA:", TARGET_EOA);
  console.log();
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  
  // 计算 salt
  const currentIndex = await factory.nextIndexOfCreator(TARGET_EOA);
  const salt = await accountDeployer.computeSalt(TARGET_EOA, currentIndex);
  console.log("Salt:", salt);
  
  // 准备 initCode
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (!initCode) {
    throw new Error("无法生成 initCode");
  }
  
  console.log("InitCode 长度:", initCode.length);
  console.log("InitCode Hash:", ethers.keccak256(initCode));
  
  // 计算预期地址
  const initCodeHash = ethers.keccak256(initCode);
  const hash = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes1", "address", "bytes32", "bytes32"],
      ["0xff", deployerAddress, salt, initCodeHash]
    )
  );
  const expectedAddress = ethers.getAddress("0x" + hash.slice(-40));
  console.log("预期地址:", expectedAddress);
  
  // 检查地址是否已有代码
  const code = await ethers.provider.getCode(expectedAddress);
  console.log("地址上的代码长度:", code.length);
  
  // 尝试从 Factory 调用 Deployer.deploy（模拟）
  console.log("\n尝试从 Factory 调用 Deployer.deploy...");
  try {
    const deployerIface = accountDeployer.interface;
    const deployData = deployerIface.encodeFunctionData("deploy", [salt, initCode]);
    
    // 使用 Factory 作为 from 地址模拟调用
    const result = await ethers.provider.call({
      to: deployerAddress,
      data: deployData,
      from: factoryAddress
    });
    
    console.log("✅ Deployer.deploy 调用成功");
    const decoded = deployerIface.decodeFunctionResult("deploy", result);
    console.log("返回地址:", decoded[0]);
    
    if (decoded[0].toLowerCase() === expectedAddress.toLowerCase()) {
      console.log("✅ 返回地址与预期地址一致");
    } else {
      console.log("❌ 返回地址与预期地址不一致");
      console.log("   返回:", decoded[0]);
      console.log("   预期:", expectedAddress);
    }
  } catch (error: any) {
    console.error("❌ Deployer.deploy 调用失败:", error.message);
    if (error.data && error.data !== "0x") {
      console.error("错误数据:", error.data);
      
      // 尝试解码错误
      try {
        const deployerIface = accountDeployer.interface;
        // 尝试常见的错误类型
        const errorTypes = ["Error(string)", "Panic(uint256)"];
        for (const errorType of errorTypes) {
          try {
            const decoded = deployerIface.decodeErrorResult(errorType, error.data);
            console.log(`解码错误 (${errorType}):`, decoded);
            break;
          } catch (e) {
            // 继续尝试下一个
          }
        }
      } catch (e) {
        console.log("无法解码错误数据");
      }
    }
  }
  
  // 检查 Factory 的 _initCode() 是否与我们的 initCode 一致
  console.log("\n检查 Factory._initCode()...");
  try {
    // Factory._initCode() 是 internal，无法直接调用
    // 但我们可以手动构建相同的 initCode
    const factoryInitCode = ethers.concat([
      BeamioAccountFactory.bytecode,
      ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ENTRY_POINT])
    ]);
    
    console.log("Factory._initCode() 长度:", factoryInitCode.length);
    console.log("Factory._initCode() Hash:", ethers.keccak256(factoryInitCode));
    console.log("是否与我们的 initCode 一致:", ethers.keccak256(factoryInitCode) === ethers.keccak256(initCode));
  } catch (error: any) {
    console.error("检查失败:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
