import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0x17DB55F18e004Ea96F4D8362f5496749a423A63c";
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  const deployerAddress = await factory.deployer();
  
  console.log("测试新 Factory.getAddress...");
  console.log("Factory:", factoryAddress);
  console.log("Deployer:", deployerAddress);
  console.log("目标 EOA:", TARGET_EOA);
  console.log();
  
  // 使用直接调用
  const iface = factory.interface;
  const data = iface.encodeFunctionData("getAddress", [TARGET_EOA, 0]);
  const result = await ethers.provider.call({
    to: factoryAddress,
    data: data
  });
  const decoded = iface.decodeFunctionResult("getAddress", result);
  const factoryComputedAddress = decoded[0];
  
  console.log("Factory.getAddress 返回:", factoryComputedAddress);
  
  // 手动计算验证
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  const salt = await accountDeployer.computeSalt(TARGET_EOA, 0);
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
    
    console.log("手动计算地址:", manualAddress);
    console.log("是否一致:", factoryComputedAddress.toLowerCase() === manualAddress.toLowerCase() ? "✅" : "❌");
    
    if (factoryComputedAddress.toLowerCase() === manualAddress.toLowerCase()) {
      console.log("\n✅ Factory.getAddress 工作正常!");
    } else {
      console.log("\n❌ Factory.getAddress 返回错误地址");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
