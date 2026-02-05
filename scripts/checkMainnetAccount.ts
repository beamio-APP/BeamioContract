import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0xFD48F7a6bBEb0c0C1ff756C38cA7fE7544239767";
  const accountAddress = "0xf174C1eC4A1D7101401032f61059fb87c37e138E";
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  console.log("检查主网账户状态...");
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
