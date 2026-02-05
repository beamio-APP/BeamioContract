import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  const factoryAddress = "0xabc1167197F6D3Be689765A774b1A3A5B4e79D1D";
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  console.log("模拟调用 createAccountFor...");
  console.log("Factory:", factoryAddress);
  console.log("目标 EOA:", TARGET_EOA);
  console.log("调用者:", signer.address);
  console.log();
  
  // 检查权限
  const isPayMaster = await factory.isPayMaster(signer.address);
  console.log("是否为 Paymaster:", isPayMaster);
  
  if (!isPayMaster) {
    console.log("❌ 不是 Paymaster，无法调用 createAccountFor");
    return;
  }
  
  // 检查账户限制
  const accountLimit = await factory.accountLimit();
  const nextIndex = await factory.nextIndexOfCreator(TARGET_EOA);
  console.log("账户限制:", accountLimit.toString());
  console.log("当前索引:", nextIndex.toString());
  
  if (nextIndex >= accountLimit) {
    console.log("❌ 已达到账户限制");
    return;
  }
  
  // 使用静态调用模拟
  try {
    console.log("\n尝试静态调用 createAccountFor...");
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
        // 尝试其他解码方式
        try {
          const abiCoder = ethers.AbiCoder.defaultAbiCoder();
          const decoded = abiCoder.decode(["string"], "0x" + error.data.slice(10));
          console.error("错误原因:", decoded[0]);
        } catch (e2) {
          console.error("无法解析错误数据");
        }
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
