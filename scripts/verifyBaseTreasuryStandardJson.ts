/**
 * 使用 Standard JSON Input 在 BaseScan 验证 BaseTreasury
 * 支持 via-IR 编译
 *
 * 运行: npx tsx scripts/verifyBaseTreasuryStandardJson.ts
 * 需先部署并设置 BASESCAN_API_KEY
 *
 * 部署信息从 deployments/base-BaseTreasury.json 读取
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASESCAN_API = "https://api.basescan.org/api";
const CHAIN_ID = 8453;
const COMPILER_VERSION = "v0.8.33+commit.64118f21";

// BaseTreasury 及其依赖
const BASE_TREASURY_SOURCES = [
  "project/src/b-unit/baseTreasury.sol",
  "project/src/contracts/utils/cryptography/ECDSA.sol",
];

async function verifyViaStandardJson(
  address: string,
  contractName: string,
  sourceKeys: string[],
  fullInput: { language: string; sources: Record<string, { content: string }>; settings: Record<string, unknown> },
  constructorArgsHex: string
): Promise<{ ok: boolean; message: string }> {
  const minimalSources: Record<string, { content: string }> = {};
  for (const key of sourceKeys) {
    if (fullInput.sources[key]) {
      minimalSources[key] = fullInput.sources[key];
    }
  }

  const minimalInput = {
    language: fullInput.language,
    sources: minimalSources,
    settings: fullInput.settings,
  };

  const standardJson = JSON.stringify(minimalInput);
  console.log(`  Standard JSON 大小: ${standardJson.length} bytes`);
  console.log(`  contract_name: ${contractName}`);

  const apiKey = process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "未设置 BASESCAN_API_KEY 或 ETHERSCAN_API_KEY" };
  }

  const params = new URLSearchParams();
  params.append("module", "contract");
  params.append("action", "verifysourcecode");
  params.append("chainid", String(CHAIN_ID));
  params.append("contractaddress", address);
  params.append("sourceCode", standardJson);
  params.append("codeformat", "solidity-standard-json-input");
  params.append("contractname", contractName);
  params.append("compilerversion", COMPILER_VERSION);
  params.append("optimizationUsed", "1");
  params.append("runs", "1");
  params.append("constructorArguements", constructorArgsHex);
  params.append("apikey", apiKey);
  params.append("licenseType", "3"); // MIT

  const res = await fetch(BASESCAN_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as { status?: string; result?: string; message?: string };

  if (!res.ok) {
    console.error("  API 响应 status:", res.status, res.statusText);
    console.error("  API 响应 body:", JSON.stringify(data, null, 2));
  } else if (process.env.VERBOSE) {
    console.log("  API 响应:", JSON.stringify(data, null, 2));
  }

  const ok =
    res.ok &&
    (data.status === "1" ||
      (data.message?.toLowerCase().includes("successfully") ?? false) ||
      (data.message?.toLowerCase().includes("already verified") ?? false) ||
      (data.result?.toLowerCase().includes("guid") ?? false));

  return { ok, message: data.message || data.result || JSON.stringify(data) };
}

async function main() {
  const deployPath = path.join(__dirname, "../deployments/base-BaseTreasury.json");
  if (!fs.existsSync(deployPath)) {
    throw new Error("未找到部署文件: " + deployPath + "\n请先运行: npx hardhat run scripts/deployBaseTreasury.ts --network base");
  }

  const deploy = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  const address = deploy.address;
  if (!address) {
    throw new Error("部署文件缺少 address");
  }

  const buildInfoDir = path.join(__dirname, "../artifacts/build-info");
  const files = fs.readdirSync(buildInfoDir).filter((f) => f.endsWith(".json") && !f.includes(".output."));
  let buildInfoPath: string | null = null;
  for (const f of files) {
    const content = fs.readFileSync(path.join(buildInfoDir, f), "utf-8");
    if (content.includes("project/src/b-unit/baseTreasury.sol")) {
      buildInfoPath = path.join(buildInfoDir, f);
      break;
    }
  }

  if (!buildInfoPath) {
    throw new Error("未找到包含 BaseTreasury 的 build-info，请先运行: npx hardhat compile");
  }

  const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf-8"));
  const fullInput = buildInfo.input as {
    language: string;
    sources: Record<string, { content: string }>;
    settings: Record<string, unknown>;
  };

  console.log("=".repeat(60));
  console.log("BaseScan Standard JSON 验证 BaseTreasury");
  console.log("=".repeat(60));
  console.log("地址:", address);
  console.log("build-info:", path.basename(buildInfoPath));
  console.log("viaIR:", (fullInput.settings as { viaIR?: boolean })?.viaIR);

  // Etherscan 标准 JSON 格式: sourceFile:ContractName
  const contractName = "baseTreasury.sol:BaseTreasury";
  const constructorArgsHex = "";

  console.log("\n提交验证...");
  const result = await verifyViaStandardJson(
    address,
    contractName,
    BASE_TREASURY_SOURCES,
    fullInput,
    constructorArgsHex
  );

  if (result.ok) {
    console.log("\n✅ 验证已提交！");
    if (result.message) console.log("  ", result.message);
    console.log("  查看: https://basescan.org/address/" + address + "#code");
    console.log("\n  验证可能需要 30 秒至数分钟，请稍后在 BaseScan 查看");
  } else {
    console.error("\n❌ 验证失败:", result.message);
    if (!result.message.toLowerCase().includes("already verified")) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
