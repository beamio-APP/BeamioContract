import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0xabc1167197F6D3Be689765A774b1A3A5B4e79D1D";
  const testEOA = "0x87cAeD4e51C36a2C2ece3Aaf4ddaC9693d2405E1";
  
  console.log("直接调用 Factory.getAddress...");
  console.log("Factory 地址:", factoryAddress);
  console.log("测试 EOA:", testEOA);
  console.log();
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const iface = factory.interface;
  
  // 方法 1: 使用 encodeFunctionData
  const data = iface.encodeFunctionData("getAddress", [testEOA, 0]);
  console.log("调用数据:", data);
  
  const result = await ethers.provider.call({
    to: factoryAddress,
    data: data
  });
  
  console.log("返回数据:", result);
  
  const decoded = iface.decodeFunctionResult("getAddress", result);
  console.log("解码结果:", decoded[0]);
  
  // 手动计算验证
  const deployerAddress = await factory.deployer();
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  const salt = await accountDeployer.computeSalt(testEOA, 0);
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
    
    console.log("\n手动计算地址:", manualAddress);
    console.log("是否一致:", decoded[0].toLowerCase() === manualAddress.toLowerCase() ? "✅" : "❌");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
