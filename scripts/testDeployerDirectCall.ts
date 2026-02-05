import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const deployerAddress = "0xD98E6D80eFE306301515046f58CeB287401373A8"; // Base Sepolia
  
  console.log("测试 Deployer.getAddress 直接调用...");
  console.log("Deployer 地址:", deployerAddress);
  
  const TEST_EOA = "0x87cAeD4e51C36a2C2ece3Aaf4ddaC9693d2405E1";
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (!initCode) {
    throw new Error("无法生成 initCode");
  }
  
  // 计算 salt
  const salt = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [TEST_EOA, 0])
  );
  
  console.log("\nSalt:", salt);
  console.log("InitCode 长度:", initCode.length);
  
  // 方法 1: 使用 getContractAt（有问题）
  console.log("\n方法 1: 使用 getContractAt");
  try {
    const deployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
    const result1 = await deployer.getAddress(salt, initCode);
    console.log("结果:", result1);
    console.log("是否正确:", result1.toLowerCase() !== deployerAddress.toLowerCase() ? "✅" : "❌");
  } catch (error: any) {
    console.log("错误:", error.message);
  }
  
  // 方法 2: 直接调用（正确）
  console.log("\n方法 2: 直接调用");
  const iface = new ethers.Interface([
    "function getAddress(bytes32 salt, bytes calldata initCode) public view returns (address)"
  ]);
  const selector = iface.getFunction("getAddress").selector;
  
  const callData = ethers.concat([
    selector,
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes"],
      [salt, initCode]
    )
  ]);
  
  const result2 = await ethers.provider.call({
    to: deployerAddress,
    data: callData
  });
  
  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["address"], result2);
  console.log("结果:", decoded[0]);
  
  // 手动计算验证
  const initCodeHash = ethers.keccak256(initCode);
  const manualHash = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes1", "address", "bytes32", "bytes32"],
      ["0xff", deployerAddress, salt, initCodeHash]
    )
  );
  const manualAddress = ethers.getAddress("0x" + manualHash.slice(-40));
  console.log("手动计算地址:", manualAddress);
  console.log("是否一致:", decoded[0].toLowerCase() === manualAddress.toLowerCase() ? "✅" : "❌");
  
  // 方法 3: 使用 encodeFunctionData
  console.log("\n方法 3: 使用 encodeFunctionData");
  try {
    const deployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
    const data = deployer.interface.encodeFunctionData("getAddress", [salt, initCode]);
    const result3 = await ethers.provider.call({
      to: deployerAddress,
      data: data
    });
    const decoded3 = deployer.interface.decodeFunctionResult("getAddress", result3);
    console.log("结果:", decoded3[0]);
    console.log("是否正确:", decoded3[0].toLowerCase() !== deployerAddress.toLowerCase() ? "✅" : "❌");
  } catch (error: any) {
    console.log("错误:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
