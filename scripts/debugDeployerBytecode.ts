import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const deployerAddress = "0xD98E6D80eFE306301515046f58CeB287401373A8"; // Base Sepolia
  
  console.log("检查 Deployer 合约字节码...");
  console.log("Deployer 地址:", deployerAddress);
  
  const code = await ethers.provider.getCode(deployerAddress);
  console.log("代码长度:", code.length);
  console.log("代码前 100 个字符:", code.slice(0, 100));
  
  // 尝试获取合约实例
  const deployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  
  // 测试 getAddress 函数
  console.log("\n测试 getAddress 函数...");
  const TEST_SALT = "0x91f896616a8a6137d5c2dcfd0a423f8149acd999eb480017ba6fdf0b943e0a2e";
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (!initCode) {
    throw new Error("无法生成 initCode");
  }
  
  console.log("Salt:", TEST_SALT);
  console.log("InitCode 长度:", initCode.length);
  
  // 直接调用 getAddress
  const result = await deployer.getAddress(TEST_SALT, initCode);
  console.log("getAddress 返回:", result);
  console.log("是否等于 Deployer 地址:", result.toLowerCase() === deployerAddress.toLowerCase());
  
  // 检查函数选择器
  const iface = new ethers.Interface([
    "function getAddress(bytes32 salt, bytes calldata initCode) public view returns (address)"
  ]);
  const selector = iface.getFunction("getAddress").selector;
  console.log("\ngetAddress 函数选择器:", selector);
  
  // 尝试直接调用（使用 callStatic）
  try {
    const callResult = await ethers.provider.call({
      to: deployerAddress,
      data: ethers.concat([
        selector,
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "bytes"],
          [TEST_SALT, initCode]
        )
      ])
    });
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["address"], callResult);
    console.log("直接调用返回:", decoded[0]);
  } catch (error: any) {
    console.log("直接调用失败:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
