import { run } from "hardhat";

/**
 * 验证合约的通用函数
 * 支持多种验证方式：BaseScan、Sourcify 等
 */
export async function verifyContract(
  address: string,
  constructorArguments: any[],
  contractName?: string
): Promise<boolean> {
  const network = await run("network");
  const networkName = network.name;
  
  console.log(`\n开始验证合约 ${contractName || address}...`);
  console.log(`网络: ${networkName}`);
  console.log(`地址: ${address}`);
  
  // 检查是否配置了 API Key
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey && (networkName === "base" || networkName === "baseSepolia")) {
    console.log("⚠️  未配置 BASESCAN_API_KEY，跳过验证");
    console.log("提示: 在 .env 文件中设置 BASESCAN_API_KEY 以启用自动验证");
    return false;
  }
  
  try {
    // 等待区块确认（BaseScan 需要等待几个区块）
    console.log("等待区块确认（30秒）...");
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // 使用 Hardhat verify 插件验证
    await run("verify:verify", {
      address: address,
      constructorArguments: constructorArguments,
    });
    
    console.log(`✅ 合约验证成功!`);
    console.log(`查看合约: https://basescan.org/address/${address}#code`);
    return true;
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    
    if (errorMessage.includes("Already Verified") || errorMessage.includes("already verified")) {
      console.log("✅ 合约已经验证过了");
      return true;
    } else if (errorMessage.includes("does not have bytecode")) {
      console.log("⚠️  合约地址没有字节码，可能还未部署完成");
      return false;
    } else if (errorMessage.includes("Fail - Unable to verify")) {
      console.log("⚠️  验证失败，可能是网络问题或合约信息不匹配");
      console.log(`错误详情: ${errorMessage}`);
      return false;
    } else {
      console.log(`⚠️  验证失败: ${errorMessage}`);
      return false;
    }
  }
}

/**
 * 验证通过 CREATE2 部署的合约（如通过 BeamioAccountDeployer）
 * 需要提供部署器地址和 salt
 */
export async function verifyCreate2Contract(
  deployedAddress: string,
  deployerAddress: string,
  salt: string,
  initCodeHash: string,
  constructorArguments: any[]
): Promise<boolean> {
  console.log(`\n验证 CREATE2 部署的合约...`);
  console.log(`部署地址: ${deployedAddress}`);
  console.log(`部署器地址: ${deployerAddress}`);
  console.log(`Salt: ${salt}`);
  
  // 对于 CREATE2 部署的合约，我们需要使用标准验证
  // BaseScan 会自动识别 CREATE2 部署
  return await verifyContract(deployedAddress, constructorArguments);
}
