/**
 * 在 CoNET Mainnet Explorer 验证 BUnitAirdrop 与 ConetTreasury
 *
 * 运行: npx hardhat run scripts/verifyConetDeployments.ts --network conet
 */

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AIRDROP_PATH = path.join(__dirname, "../deployments/conet-BUintAirdrop.json");
const TREASURY_PATH = path.join(__dirname, "../deployments/conet-ConetTreasury.json");

function runVerify(address: string, contract: string, constructorArgs: string[] = []): boolean {
  const args = [
    "npx",
    "hardhat",
    "verify",
    "blockscout",
    "--network",
    "conet",
    "--contract",
    contract,
    address,
    ...constructorArgs,
  ];
  try {
    execSync(args.join(" "), {
      stdio: "inherit",
      cwd: path.join(__dirname, ".."),
    });
    return true;
  } catch (e) {
    const output = (e as { stdout?: Buffer; stderr?: Buffer })?.stderr?.toString() ?? "";
    if (
      output.includes("Already Verified") ||
      output.includes("already verified") ||
      output.includes("Contract source code already verified")
    ) {
      return true;
    }
    throw e;
  }
}

async function main() {
  if (!fs.existsSync(AIRDROP_PATH) || !fs.existsSync(TREASURY_PATH)) {
    throw new Error("缺少 conet-BUintAirdrop.json 或 conet-ConetTreasury.json");
  }

  const airdropData = JSON.parse(fs.readFileSync(AIRDROP_PATH, "utf-8"));
  const treasuryData = JSON.parse(fs.readFileSync(TREASURY_PATH, "utf-8"));

  const buintAddr = airdropData.contracts?.BUint?.address;
  const airdropAddr = airdropData.contracts?.BUnitAirdrop?.address;
  const airdropDeployer = airdropData.deployer;
  const treasuryAddr = treasuryData.contracts?.ConetTreasury?.address;
  const conetUsdcAddr = treasuryData.contracts?.ConetTreasury?.conetUsdc;

  if (!buintAddr || !airdropAddr || !airdropDeployer) {
    throw new Error("conet-BUintAirdrop.json 缺少 BUint / BUnitAirdrop 地址或 deployer");
  }
  if (!treasuryAddr) {
    throw new Error("conet-ConetTreasury.json 缺少 ConetTreasury 地址");
  }

  console.log("=".repeat(60));
  console.log("验证 BUnitAirdrop、ConetTreasury、conetUSDC 到 CoNET Explorer");
  console.log("=".repeat(60));
  console.log("BUnitAirdrop:", airdropAddr);
  console.log("ConetTreasury:", treasuryAddr);
  console.log("conetUSDC:", conetUsdcAddr ?? "(未配置)");

  // 1. 验证 BUnitAirdrop - constructor(_bunit, initialOwner)
  console.log("\n[1/3] 验证 BUnitAirdrop...");
  try {
    runVerify(airdropAddr, "src/b-unit/BUnitAirdrop.sol:BUnitAirdrop", [
      buintAddr,
      airdropDeployer,
    ]);
    console.log("  ✅ BUnitAirdrop 验证成功");
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (msg.includes("Already Verified") || msg.includes("already verified")) {
      console.log("  ⏭️ BUnitAirdrop 已验证，跳过");
    } else {
      throw e;
    }
  }

  // 2. 验证 ConetTreasury - 无 constructor 参数
  console.log("\n[2/3] 验证 ConetTreasury...");
  try {
    runVerify(treasuryAddr, "src/b-unit/conetTreasury.sol:ConetTreasury");
    console.log("  ✅ ConetTreasury 验证成功");
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (msg.includes("Already Verified") || msg.includes("already verified")) {
      console.log("  ⏭️ ConetTreasury 已验证，跳过");
    } else {
      throw e;
    }
  }

  // 3. 验证 conetUSDC (FactoryERC20) - constructor(name_, symbol_, decimals_, minter_)
  if (conetUsdcAddr) {
    console.log("\n[3/3] 验证 conetUSDC (FactoryERC20)...");
    try {
      runVerify(conetUsdcAddr, "src/b-unit/conetTreasury.sol:FactoryERC20", [
        '"USD Coin"',
        '"USDC"',
        "6",
        treasuryAddr,
      ]);
      console.log("  ✅ conetUSDC 验证成功");
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      if (msg.includes("Already Verified") || msg.includes("already verified")) {
        console.log("  ⏭️ conetUSDC 已验证，跳过");
      } else {
        throw e;
      }
    }
  } else {
    console.log("\n[3/3] conet-ConetTreasury.json 无 conetUsdc，跳过 conetUSDC 验证");
  }

  console.log("\n✅ 全部验证完成！");
  console.log("  BUnitAirdrop: https://mainnet.conet.network/address/" + airdropAddr);
  console.log("  ConetTreasury: https://mainnet.conet.network/address/" + treasuryAddr);
  if (conetUsdcAddr) {
    console.log("  conetUSDC: https://mainnet.conet.network/address/" + conetUsdcAddr);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
