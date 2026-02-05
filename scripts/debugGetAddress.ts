import { network as networkModule } from "hardhat";
import { keccak256 } from "ethers";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0xa6B61e49A754567638891580C617D6912268674f";
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  const deployerAddress = await factory.deployer();
  
  console.log("Deployer 地址:", deployerAddress);
  console.log("目标 EOA:", TARGET_EOA);
  
  const accountDeployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const BeamioAccountFactory = await ethers.getContractFactory("BeamioAccount");
  const deployTx = await BeamioAccountFactory.getDeployTransaction(ENTRY_POINT);
  const initCode = deployTx.data;
  
  if (!initCode) {
    throw new Error("无法生成 initCode");
  }
  
  console.log("InitCode 长度:", initCode.length);
  const initCodeHash = keccak256(initCode);
  console.log("InitCode Hash:", initCodeHash);
  
  // 检查 index 0-2 的地址计算
  for (let i = 0; i <= 2; i++) {
    const salt = await accountDeployer.computeSalt(TARGET_EOA, i);
    const address = await accountDeployer.getAddress(salt, initCode);
    
    // 手动计算地址
    const manualHash = keccak256(
      ethers.solidityPacked(
        ["bytes1", "address", "bytes32", "bytes32"],
        ["0xff", deployerAddress, salt, initCodeHash]
      )
    );
    const manualAddress = ethers.getAddress("0x" + manualHash.slice(-40));
    
    console.log(`\nIndex ${i}:`);
    console.log("  Salt:", salt);
    console.log("  地址 (合约计算):", address);
    console.log("  地址 (手动计算):", manualAddress);
    console.log("  是否一致:", address.toLowerCase() === manualAddress.toLowerCase());
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
