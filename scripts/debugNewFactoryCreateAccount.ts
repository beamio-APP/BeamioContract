import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  const factoryAddress = "0x17DB55F18e004Ea96F4D8362f5496749a423A63c";
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  console.log("调试新 Factory.createAccountFor...");
  console.log("Factory:", factoryAddress);
  console.log("目标 EOA:", TARGET_EOA);
  console.log("调用者:", signer.address);
  console.log();
  
  // 检查权限
  const isPayMaster = await factory.isPayMaster(signer.address);
  console.log("是否为 Paymaster:", isPayMaster);
  
  if (!isPayMaster) {
    console.log("❌ 不是 Paymaster");
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
  
  // 检查 Factory.getAddress
  console.log("\n检查 Factory.getAddress...");
  const iface = factory.interface;
  const getAddressData = iface.encodeFunctionData("getAddress", [TARGET_EOA, nextIndex]);
  const getAddressResult = await ethers.provider.call({
    to: factoryAddress,
    data: getAddressData
  });
  const getAddressDecoded = iface.decodeFunctionResult("getAddress", getAddressResult);
  const computedAddress = getAddressDecoded[0];
  console.log("Factory.getAddress 返回:", computedAddress);
  
  // 检查地址上的代码
  const code = await ethers.provider.getCode(computedAddress);
  console.log("地址上的代码长度:", code.length);
  
  // 尝试静态调用 createAccountFor
  console.log("\n尝试静态调用 createAccountFor...");
  try {
    const result = await factory.createAccountFor.staticCall(TARGET_EOA);
    console.log("✅ 静态调用成功，返回地址:", result);
  } catch (error: any) {
    console.error("❌ 静态调用失败:");
    console.error("错误信息:", error.message);
    if (error.data && error.data !== "0x") {
      console.error("错误数据:", error.data);
      // 尝试解码错误
      try {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const decoded = abiCoder.decode(["string"], "0x" + error.data.slice(10));
        console.error("错误原因:", decoded[0]);
      } catch (e) {
        console.error("无法解析错误数据");
      }
    }
  }
  
  // 尝试直接调用
  console.log("\n尝试直接调用 createAccountFor...");
  try {
    const callData = iface.encodeFunctionData("createAccountFor", [TARGET_EOA]);
    const result = await ethers.provider.call({
      to: factoryAddress,
      data: callData,
      from: signer.address
    });
    console.log("✅ 直接调用成功，返回:", result);
    const decoded = iface.decodeFunctionResult("createAccountFor", result);
    console.log("解码结果:", decoded[0]);
  } catch (error: any) {
    console.error("❌ 直接调用失败:");
    console.error("错误信息:", error.message);
    if (error.data && error.data !== "0x") {
      console.error("错误数据:", error.data);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
