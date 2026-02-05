import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0x17DB55F18e004Ea96F4D8362f5496749a423A63c";
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  console.log("检查新 Factory 配置...");
  console.log("Factory 地址:", factoryAddress);
  console.log();
  
  const deployerAddress = await factory.deployer();
  console.log("Factory.deployer():", deployerAddress);
  
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  const deployerFactory = await accountDeployer.factory();
  console.log("Deployer.factory():", deployerFactory);
  
  if (deployerFactory.toLowerCase() === factoryAddress.toLowerCase()) {
    console.log("✅ Deployer 的 Factory 地址设置正确");
  } else {
    console.log("❌ Deployer 的 Factory 地址不匹配");
    console.log("   当前:", deployerFactory);
    console.log("   期望:", factoryAddress);
  }
  
  console.log();
  
  // 检查其他配置
  const containerModule = await factory.containerModule();
  const quoteHelper = await factory.quoteHelper();
  const userCard = await factory.beamioUserCard();
  const usdc = await factory.USDC();
  const accountLimit = await factory.accountLimit();
  
  console.log("Container Module:", containerModule);
  console.log("Quote Helper:", quoteHelper);
  console.log("User Card:", userCard);
  console.log("USDC:", usdc);
  console.log("Account Limit:", accountLimit.toString());
  
  // 检查调用者是否为 Paymaster
  const [signer] = await ethers.getSigners();
  const isPayMaster = await factory.isPayMaster(signer.address);
  console.log("\n调用者:", signer.address);
  console.log("是否为 Paymaster:", isPayMaster);
  
  // 测试 Deployer.deploy 调用（需要 Factory 权限）
  console.log("\n测试 Deployer.deploy 调用...");
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  const salt = await accountDeployer.computeSalt(TARGET_EOA, 0);
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (initCode) {
    // 尝试从 Factory 调用 Deployer.deploy
    console.log("Salt:", salt);
    console.log("InitCode 长度:", initCode.length);
    
    // 检查 Factory 是否可以调用 Deployer.deploy
    try {
      // 使用 Factory 的地址作为 from 来模拟调用
      const deployerIface = accountDeployer.interface;
      const deployData = deployerIface.encodeFunctionData("deploy", [salt, initCode]);
      
      // 尝试从 Factory 调用
      const result = await ethers.provider.call({
        to: deployerAddress,
        data: deployData,
        from: factoryAddress
      });
      
      console.log("✅ Deployer.deploy 调用成功");
      const decoded = deployerIface.decodeFunctionResult("deploy", result);
      console.log("返回地址:", decoded[0]);
    } catch (error: any) {
      console.error("❌ Deployer.deploy 调用失败:", error.message);
      if (error.data && error.data !== "0x") {
        console.error("错误数据:", error.data);
        try {
          const abiCoder = ethers.AbiCoder.defaultAbiCoder();
          const decoded = abiCoder.decode(["string"], "0x" + error.data.slice(10));
          console.error("错误原因:", decoded[0]);
        } catch (e) {
          console.error("无法解析错误数据");
        }
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
