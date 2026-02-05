import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0xFD48F7a6bBEb0c0C1ff756C38cA7fE7544239767";
  const accountAddress = "0xA5deECC4b0D86338B7c99fAbF611ca117582D887";
  const TARGET_EOA = "0xEaBF0A98aC208647247eAA25fDD4eB0e67793d61";
  
  console.log("检查账户状态...");
  console.log("Factory:", factoryAddress);
  console.log("账户地址:", accountAddress);
  console.log("EOA:", TARGET_EOA);
  console.log();
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  const isRegistered = await factory.isBeamioAccount(accountAddress);
  console.log("✅ 是否在 Factory 注册:", isRegistered);
  
  const primaryAccount = await factory.beamioAccountOf(TARGET_EOA);
  console.log("✅ EOA 的主账户:", primaryAccount);
  
  const code = await ethers.provider.getCode(accountAddress);
  console.log("✅ 账户代码长度:", code.length);
  
  if (isRegistered && primaryAccount.toLowerCase() === accountAddress.toLowerCase() && code.length > 2) {
    console.log("\n🎉 账户部署和注册完全成功！");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
