/**
 * 导出 BaseTreasury 的 Standard JSON 和 Compiler Version
 * 运行: npx tsx scripts/exportBaseTreasuryVerifyData.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_TREASURY_SOURCES = [
  "project/src/b-unit/baseTreasury.sol",
  "project/src/contracts/utils/cryptography/ECDSA.sol",
];

function main() {
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

  const minimalSources: Record<string, { content: string }> = {};
  for (const key of BASE_TREASURY_SOURCES) {
    if (fullInput.sources[key]) {
      minimalSources[key] = fullInput.sources[key];
    }
  }

  const standardJsonInput = {
    language: fullInput.language,
    sources: minimalSources,
    settings: fullInput.settings,
  };

  const standardJson = JSON.stringify(standardJsonInput, null, 2);
  const compilerVersion = buildInfo.solcLongVersion || "v0.8.33+commit.64118f21";

  const outDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "base-BaseTreasury-standard-input.json");
  fs.writeFileSync(jsonPath, standardJson, "utf-8");

  const metaPath = path.join(outDir, "base-BaseTreasury-verify-meta.txt");
  fs.writeFileSync(
    metaPath,
    `Compiler Version: ${compilerVersion}
Contract Name: baseTreasury.sol:BaseTreasury
Constructor Arguments: (空)
Optimization: Enabled
Runs: 1
`,
    "utf-8"
  );

  console.log("已导出:");
  console.log("  Standard JSON:", jsonPath);
  console.log("  验证元数据:", metaPath);
  console.log("\nCompiler Version:", compilerVersion);
  console.log("\nStandard JSON 已保存，可直接复制到 BaseScan 手动验证页面");
}

main();
