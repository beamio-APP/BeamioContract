import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const txHash = "0xe9aba511e065d81954274fab36ba4f2b60991cfafc1bd0b1d3913684be443bb1";
  
  console.log("调试失败交易...");
  console.log("交易哈希:", txHash);
  console.log();
  
  const receipt = await ethers.provider.getTransactionReceipt(txHash);
  console.log("交易状态:", receipt.status === 1 ? "成功" : "失败");
  console.log("Gas 使用:", receipt.gasUsed.toString());
  console.log("日志数量:", receipt.logs.length);
  
  if (receipt.status === 0) {
    console.log("\n交易执行失败，尝试获取 trace...");
    
    // 尝试使用 debug_traceTransaction
    try {
      const trace = await ethers.provider.send("debug_traceTransaction", [txHash, {
        tracer: "callTracer",
        tracerConfig: {
          onlyTopCall: false,
          withLog: true
        }
      }]);
      
      console.log("\n=== Trace 结果 ===");
      console.log(JSON.stringify(trace, null, 2).slice(0, 2000));
      
      // 查找错误
      const findError = (obj: any): any => {
        if (obj.error) {
          return obj.error;
        }
        if (obj.calls) {
          for (const call of obj.calls) {
            const err = findError(call);
            if (err) return err;
          }
        }
        return null;
      };
      
      const error = findError(trace);
      if (error) {
        console.log("\n=== 发现的错误 ===");
        console.log(JSON.stringify(error, null, 2));
      }
    } catch (error: any) {
      console.log("无法获取 trace:", error.message);
      
      // 尝试使用 callTracer
      try {
        const trace2 = await ethers.provider.send("debug_traceTransaction", [txHash, {
          tracer: "callTracer"
        }]);
        console.log("\n=== Call Tracer 结果 ===");
        console.log(JSON.stringify(trace2, null, 2).slice(0, 2000));
      } catch (error2: any) {
        console.log("Call Tracer 也失败:", error2.message);
      }
    }
  }
  
  // 尝试模拟调用以获取错误信息
  console.log("\n=== 尝试模拟调用 ===");
  const tx = await ethers.provider.getTransaction(txHash);
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", tx.to!);
  const TARGET_EOA = "0xDfB6c751653ae61C80512167a2154A68BCC97f1F";
  
  try {
    // 使用 staticCall 模拟
    const result = await factory.createAccountFor.staticCall(TARGET_EOA);
    console.log("静态调用成功，返回:", result);
  } catch (error: any) {
    console.log("静态调用失败:", error.message);
    if (error.data && error.data !== "0x") {
      console.log("错误数据:", error.data);
      try {
        // 尝试解码错误
        const iface = factory.interface;
        const errorFragment = iface.getError("Error(string)");
        if (errorFragment) {
          const decoded = iface.decodeErrorResult("Error", error.data);
          console.log("解码的错误:", decoded);
        }
      } catch (e) {
        console.log("无法解码错误数据");
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
