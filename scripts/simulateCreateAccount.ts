import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  const factoryAddress = "0xa6B61e49A754567638891580C617D6912268674f";
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  console.log("模拟调用 createAccountFor...");
  console.log("目标 EOA:", TARGET_EOA);
  console.log("调用者:", signer.address);
  
  try {
    // 使用 staticCall 模拟
    const result = await factory.createAccountFor.staticCall(TARGET_EOA);
    console.log("✅ 模拟成功，返回地址:", result);
  } catch (error: any) {
    console.error("❌ 模拟失败:");
    console.error("错误信息:", error.message);
    if (error.data) {
      console.error("错误数据:", error.data);
      // 尝试解码错误
      try {
        const reason = factory.interface.parseError(error.data);
        console.error("解析的错误:", reason);
      } catch (e) {
        console.error("无法解析错误数据");
      }
    }
    if (error.reason) {
      console.error("错误原因:", error.reason);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
