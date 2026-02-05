import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const txHash = "0xe9aba511e065d81954274fab36ba4f2b60991cfafc1bd0b1d3913684be443bb1";
  
  console.log("获取交易错误信息...");
  console.log("交易哈希:", txHash);
  console.log();
  
  const receipt = await ethers.provider.getTransactionReceipt(txHash);
  console.log("交易状态:", receipt.status === 1 ? "成功" : "失败");
  console.log("Gas 使用:", receipt.gasUsed.toString());
  console.log("日志数量:", receipt.logs.length);
  
  if (receipt.status === 0) {
    console.log("\n交易执行失败");
    
    // 尝试使用 trace 获取错误
    try {
      const trace = await ethers.provider.send("debug_traceTransaction", [txHash]);
      console.log("Trace 结果:", JSON.stringify(trace, null, 2).slice(0, 500));
    } catch (error: any) {
      console.log("无法获取 trace:", error.message);
    }
    
    // 尝试使用 call 模拟交易
    const tx = await ethers.provider.getTransaction(txHash);
    console.log("\n交易详情:");
    console.log("From:", tx.from);
    console.log("To:", tx.to);
    console.log("Data:", tx.data);
    
    // 尝试模拟调用
    try {
      const result = await ethers.provider.call({
        to: tx.to,
        data: tx.data,
        from: tx.from,
        value: tx.value
      });
      console.log("模拟调用成功:", result);
    } catch (error: any) {
      console.log("模拟调用失败:", error.message);
      if (error.data && error.data !== "0x") {
        console.log("错误数据:", error.data);
        try {
          const abiCoder = ethers.AbiCoder.defaultAbiCoder();
          const decoded = abiCoder.decode(["string"], "0x" + error.data.slice(10));
          console.log("错误原因:", decoded[0]);
        } catch (e) {
          console.log("无法解析错误数据");
        }
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
