import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { getBeamioAccount } from "./utils/getBeamioAccount.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 命令行工具：查询 EOA 的 BeamioAccount
 * 
 * 使用方法:
 *   npx hardhat run scripts/getAccount.ts --network baseSepolia -- <EOA_ADDRESS> [FACTORY_ADDRESS]
 */
async function main() {
  // 从环境变量或命令行参数获取地址
  // 优先使用环境变量 EOA_ADDRESS
  let eoaAddress = process.env.EOA_ADDRESS;
  let factoryAddress = process.env.FACTORY_ADDRESS || undefined;
  
  // 如果没有环境变量，尝试从命令行参数获取
  // Hardhat 会将 -- 后面的参数传递给脚本
  const args = process.argv.slice(process.argv.indexOf("--") + 1);
  if (args.length > 0 && !eoaAddress) {
    eoaAddress = args[0];
    if (args.length > 1) {
      factoryAddress = args[1];
    }
  }
  
  if (!eoaAddress) {
    console.log("用法:");
    console.log("  方式 1: 使用环境变量");
    console.log("    EOA_ADDRESS=0x1234... npx hardhat run scripts/getAccount.ts --network baseSepolia");
    console.log("  方式 2: 使用命令行参数");
    console.log("    npx hardhat run scripts/getAccount.ts --network baseSepolia");
    console.log("\n示例:");
    console.log("  EOA_ADDRESS=0x1234... npm run get:account:base-sepolia");
    console.log("  EOA_ADDRESS=0x1234... FACTORY_ADDRESS=0x5678... npm run get:account:base");
    process.exit(1);
  }
  
  const { ethers } = await networkModule.connect();
  const networkInfo = await ethers.provider.getNetwork();
  
  console.log("=".repeat(60));
  console.log("查询 BeamioAccount");
  console.log("=".repeat(60));
  console.log("EOA 地址:", eoaAddress);
  if (factoryAddress) {
    console.log("Factory 地址:", factoryAddress);
  }
  console.log("网络:", networkInfo.name, "(Chain ID:", networkInfo.chainId.toString() + ")");
  console.log();
  
  try {
    const result = await getBeamioAccount(eoaAddress, factoryAddress);
    
    if (result.exists && result.address) {
      console.log("✅ 找到 BeamioAccount!");
      console.log("账户地址:", result.address);
      console.log("已部署:", result.isDeployed ? "是" : "否");
      
      if (result.isDeployed) {
        const explorerBase = networkInfo.chainId === 8453n 
          ? "https://basescan.org"
          : networkInfo.chainId === 84532n
          ? "https://sepolia.basescan.org"
          : "";
        
        if (explorerBase) {
          console.log("查看账户:", `${explorerBase}/address/${result.address}`);
        }
      }
    } else {
      console.log("❌ 未找到 BeamioAccount");
      console.log("该 EOA 地址尚未创建 BeamioAccount");
      console.log("\n💡 提示: 可以使用 Factory.createAccount() 创建账户");
    }
  } catch (error: any) {
    console.error("❌ 查询失败:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
