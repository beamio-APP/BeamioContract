import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  
  const newFactoryAddress = "0xabc1167197F6D3Be689765A774b1A3A5B4e79D1D"; // 新部署的 Factory
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", newFactoryAddress);
  
  console.log("测试新部署的 Factory...");
  console.log("Factory 地址:", newFactoryAddress);
  
  const deployerAddress = await factory.deployer();
  console.log("Deployer 地址:", deployerAddress);
  
  const TEST_EOA = signer.address;
  console.log("测试 EOA:", TEST_EOA);
  console.log();
  
  // 测试 getAddress
  console.log("测试 Factory.getAddress():");
  for (let i = 0; i <= 2; i++) {
    const result = await factory.getAddress(TEST_EOA, i);
    console.log(`Index ${i}:`, result);
    
    if (result.toLowerCase() === newFactoryAddress.toLowerCase()) {
      console.log("  ❌ 返回了 Factory 地址");
    } else if (result.toLowerCase() === deployerAddress.toLowerCase()) {
      console.log("  ❌ 返回了 Deployer 地址");
    } else {
      console.log("  ✅ 返回了非 Factory/Deployer 地址");
      
      // 手动计算验证
      const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
      const salt = await accountDeployer.computeSalt(TEST_EOA, i);
      const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
      const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
      const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
      const initCode = deployTx.data;
      
      if (initCode) {
        const initCodeHash = ethers.keccak256(initCode);
        const manualHash = ethers.keccak256(
          ethers.solidityPacked(
            ["bytes1", "address", "bytes32", "bytes32"],
            ["0xff", deployerAddress, salt, initCodeHash]
          )
        );
        const manualAddress = ethers.getAddress("0x" + manualHash.slice(-40));
        
        if (result.toLowerCase() === manualAddress.toLowerCase()) {
          console.log("  ✅ 与手动计算的地址一致！");
        } else {
          console.log("  ❌ 与手动计算的地址不一致");
          console.log("  手动计算:", manualAddress);
        }
      }
    }
    console.log();
  }
  
  // 测试 createAccountFor
  console.log("测试 createAccountFor...");
  const isPayMaster = await factory.isPayMaster(signer.address);
  console.log("是否为 Paymaster:", isPayMaster);
  
  if (isPayMaster) {
    try {
      console.log("调用 createAccountFor...");
      const tx = await factory.createAccountFor(TEST_EOA);
      const receipt = await tx.wait();
      console.log("✅ 交易成功!");
      console.log("交易哈希:", receipt?.hash);
      
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
        const accountAddress = parsed?.args.account;
        console.log("创建的账户地址:", accountAddress);
      } else {
        const accountAddress = await factory.beamioAccountOf(TEST_EOA);
        console.log("查询到的账户地址:", accountAddress);
      }
    } catch (error: any) {
      console.error("❌ 创建账户失败:", error.message);
    }
  } else {
    console.log("⚠️  不是 Paymaster，无法测试 createAccountFor");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
