import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0x17DB55F18e004Ea96F4D8362f5496749a423A63c";
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  console.log("检查 nextIndexOfCreator...");
  const nextIndex = await factory.nextIndexOfCreator(TARGET_EOA);
  console.log("当前索引:", nextIndex.toString());
  
  // 检查是否因为索引已更新导致问题
  if (nextIndex > 0) {
    console.log("⚠️  索引已更新，可能之前的调用已经更新了索引");
    console.log("   尝试使用下一个索引...");
    
    // 使用下一个索引计算地址
    const deployerAddress = await factory.deployer();
    const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
    const salt = await accountDeployer.computeSalt(TARGET_EOA, nextIndex);
    const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
    const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
    const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
    const initCode = deployTx.data;
    
    if (initCode) {
      const initCodeHash = ethers.keccak256(initCode);
      const hash = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes1", "address", "bytes32", "bytes32"],
          ["0xff", deployerAddress, salt, initCodeHash]
        )
      );
      const expectedAddress = ethers.getAddress("0x" + hash.slice(-40));
      
      console.log("\n使用索引", nextIndex.toString(), "计算的地址:", expectedAddress);
      
      const code = await ethers.provider.getCode(expectedAddress);
      console.log("地址上的代码长度:", code.length);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
