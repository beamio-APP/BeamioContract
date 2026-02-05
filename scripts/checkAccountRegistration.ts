import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0x102E9FBE87a28BaC10ADbc0E67a2b0385C8Bd0E9";
  const accountAddress = "0xAB4AB39A7fcAC791536F0f343c19fa5313Ea09F6";
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  console.log("检查账户注册状态...");
  console.log("Factory:", factoryAddress);
  console.log("账户地址:", accountAddress);
  console.log("EOA:", TARGET_EOA);
  console.log();
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  const isRegistered = await factory.isBeamioAccount(accountAddress);
  console.log("是否在 Factory 注册:", isRegistered);
  
  const primaryAccount = await factory.beamioAccountOf(TARGET_EOA);
  console.log("EOA 的主账户:", primaryAccount);
  
  const accounts = await factory.myBeamioAccounts.staticCall(TARGET_EOA);
  console.log("EOA 的所有账户数量:", accounts.length);
  
  const code = await ethers.provider.getCode(accountAddress);
  console.log("账户代码长度:", code.length);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
