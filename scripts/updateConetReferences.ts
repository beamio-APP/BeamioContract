/**
 * 从 deployments/conet-addresses.json 读取 BUnitAirdrop、ConetTreasury、conetUsdc，
 * 更新项目内所有引用（chainAddresses.ts、readme、规则等）。
 *
 * 运行: npx tsx scripts/updateConetReferences.ts
 * 或: 部署完成后自动调用
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADDRESSES_PATH = path.join(__dirname, "..", "deployments", "conet-addresses.json");

function main() {
  if (!fs.existsSync(ADDRESSES_PATH)) {
    throw new Error("未找到 deployments/conet-addresses.json");
  }
  const data = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf-8"));
  const bunitAirdrop = data.BUnitAirdrop || data.contracts?.BUnitAirdrop?.address;
  const conetTreasury = data.ConetTreasury || data.contracts?.ConetTreasury?.address;
  const conetUsdc = data.conetUsdc;

  if (!bunitAirdrop) {
    throw new Error("conet-addresses.json 缺少 BUnitAirdrop 地址");
  }

  console.log("=".repeat(60));
  console.log("更新 BUnitAirdrop / ConetTreasury 引用");
  console.log("=".repeat(60));
  console.log("BUnitAirdrop:", bunitAirdrop);
  console.log("ConetTreasury:", conetTreasury ?? "(未配置)");
  console.log("conetUsdc:", conetUsdc ?? "(未配置)");

  // 1. x402sdk chainAddresses.ts
  const sdkChainPath = path.join(__dirname, "..", "src", "x402sdk", "src", "chainAddresses.ts");
  if (fs.existsSync(sdkChainPath)) {
    let content = fs.readFileSync(sdkChainPath, "utf-8");
    content = content.replace(
      /CONET_BUNIT_AIRDROP_ADDRESS\s*=\s*['"](0x[a-fA-F0-9]{40})['"]/,
      `CONET_BUNIT_AIRDROP_ADDRESS = '${bunitAirdrop}'`
    );
    fs.writeFileSync(sdkChainPath, content);
    console.log("[1] 已更新 src/x402sdk/src/chainAddresses.ts");
  }

  // 2. SilentPassUI chainAddresses (若存在 CONET 引用)
  const uiChainPath = path.join(__dirname, "..", "src", "SilentPassUI", "src", "config", "chainAddresses.ts");
  if (fs.existsSync(uiChainPath)) {
    let content = fs.readFileSync(uiChainPath, "utf-8");
    if (content.includes("CONET_BUNIT_AIRDROP") || content.includes("BUnitAirdrop")) {
      content = content.replace(
        /(CONET_BUNIT_AIRDROP[^=]*=\s*['"])(0x[a-fA-F0-9]{40})(['"])/,
        `$1${bunitAirdrop}$3`
      );
      fs.writeFileSync(uiChainPath, content);
      console.log("[2] 已更新 SilentPassUI chainAddresses.ts");
    }
  }

  // 3. src/b-unit/readme.md
  const readmePath = path.join(__dirname, "..", "src", "b-unit", "readme.md");
  if (fs.existsSync(readmePath)) {
    let content = fs.readFileSync(readmePath, "utf-8");
    content = content.replace(
      /\|\s*\*\*ConetTreasury\*\*\s*\|\s*`0x[a-fA-F0-9]{40}`/g,
      conetTreasury ? `| **ConetTreasury** | \`${conetTreasury}\`` : (m: string) => m
    );
    content = content.replace(
      /\|\s*\*\*BUnitAirdrop\*\*\s*\|\s*`0x[a-fA-F0-9]{40}`/g,
      `| **BUnitAirdrop** | \`${bunitAirdrop}\``
    );
    fs.writeFileSync(readmePath, content);
    console.log("[3] 已更新 src/b-unit/readme.md");
  }

  // 4. .cursor/rules/conet-deployments.mdc
  const rulesPath = path.join(__dirname, "..", ".cursor", "rules", "conet-deployments.mdc");
  if (fs.existsSync(rulesPath)) {
    let content = fs.readFileSync(rulesPath, "utf-8");
    content = content.replace(
      /BUnitAirdrop \(CoNET mainnet\)[^`]*`0x[a-fA-F0-9]{40}`/,
      `BUnitAirdrop (CoNET mainnet): \`${bunitAirdrop}\``
    );
    if (conetTreasury) {
      content = content.replace(
        /ConetTreasury[^`]*`0x[a-fA-F0-9]{40}`/g,
        (m) => (m.includes("ConetTreasury") ? m.replace(/0x[a-fA-F0-9]{40}/, conetTreasury) : m)
      );
    }
    fs.writeFileSync(rulesPath, content);
    console.log("[4] 已更新 .cursor/rules/conet-deployments.mdc");
  }

  // 5. SilentPassUI beamio.ts
  const silentPassBeamioPath = path.join(__dirname, "..", "src", "SilentPassUI", "src", "services", "beamio.ts");
  if (fs.existsSync(silentPassBeamioPath)) {
    let content = fs.readFileSync(silentPassBeamioPath, "utf-8");
    content = content.replace(
      /CONET_BUNIT_AIRDROP_ADDRESS\s*=\s*['"](0x[a-fA-F0-9]{40})['"]/,
      `CONET_BUNIT_AIRDROP_ADDRESS = '${bunitAirdrop}'`
    );
    fs.writeFileSync(silentPassBeamioPath, content);
    console.log("[5] 已更新 SilentPassUI beamio.ts");
  }

  // 6. bizSite beamio.ts
  const bizSiteBeamioPath = path.join(__dirname, "..", "src", "bizSite", "src", "services", "beamio.ts");
  if (fs.existsSync(bizSiteBeamioPath)) {
    let content = fs.readFileSync(bizSiteBeamioPath, "utf-8");
    content = content.replace(
      /CONET_BUNIT_AIRDROP_ADDRESS\s*=\s*['"](0x[a-fA-F0-9]{40})['"]/,
      `CONET_BUNIT_AIRDROP_ADDRESS = '${bunitAirdrop}'`
    );
    fs.writeFileSync(bizSiteBeamioPath, content);
    console.log("[6] 已更新 bizSite beamio.ts");
  }

  // 7. CoNET-SI server.ts CONET_TREASURY_ADDRESS 默认值 + env.example
  if (conetTreasury) {
    const conetSiServerPath = path.join(__dirname, "..", "src", "CoNET-SI", "src", "endpoint", "server.ts");
    if (fs.existsSync(conetSiServerPath)) {
      let content = fs.readFileSync(conetSiServerPath, "utf-8");
      content = content.replace(
        /CONET_TREASURY_ADDRESS\s*\|\|\s*['"](0x[a-fA-F0-9]{40})['"]/,
        `CONET_TREASURY_ADDRESS || '${conetTreasury}'`
      );
      fs.writeFileSync(conetSiServerPath, content);
      console.log("[7] 已更新 CoNET-SI server.ts CONET_TREASURY_ADDRESS");
    }
    const envExamplePath = path.join(__dirname, "..", "src", "CoNET-SI", "env.example");
    if (fs.existsSync(envExamplePath)) {
      let content = fs.readFileSync(envExamplePath, "utf-8");
      content = content.replace(
        /CONET_TREASURY_ADDRESS=(0x[a-fA-F0-9]{40})/,
        `CONET_TREASURY_ADDRESS=${conetTreasury}`
      );
      fs.writeFileSync(envExamplePath, content);
      console.log("[7b] 已更新 CoNET-SI env.example CONET_TREASURY_ADDRESS");
    }
  }

  // 8a. BUnitAirdrop 回退地址（scripts 中 loadBUnitAirdrop 或 BUNIT_AIRDROP 常量）
  for (const scriptRel of [
    "scripts/consumeBUnitFromUser.ts",
    "scripts/checkPurchaseAndVoteStatus.ts",
    "scripts/checkIndexerBurnRecord.ts",
    "scripts/checkBUnitAirdropBUintAdmin.ts",
    "scripts/queryBUnitAirdropIndexer.ts",
    "scripts/checkBUnitBalance.ts",
  ]) {
    const fullPath = path.join(__dirname, "..", scriptRel);
    if (fs.existsSync(fullPath)) {
      let content = fs.readFileSync(fullPath, "utf-8");
      const prev = content;
      content = content.replace(/return d\.BUnitAirdrop \|\| "0x[a-fA-F0-9]{40}"/, `return d.BUnitAirdrop || "${bunitAirdrop}"`);
      content = content.replace(/const BUNIT_AIRDROP = "0x[a-fA-F0-9]{40}"/, `const BUNIT_AIRDROP = "${bunitAirdrop}"`);
      if (content !== prev) {
        fs.writeFileSync(fullPath, content);
        console.log(`[8a] 已更新 ${scriptRel}`);
      }
    }
  }
  const treasuryJsonPath = path.join(__dirname, "..", "deployments", "conet-ConetTreasury.json");
  if (fs.existsSync(treasuryJsonPath)) {
    let content = fs.readFileSync(treasuryJsonPath, "utf-8");
    content = content.replace(/"bUnitAirdrop":\s*"0x[a-fA-F0-9]{40}"/, `"bUnitAirdrop": "${bunitAirdrop}"`);
    fs.writeFileSync(treasuryJsonPath, content);
    console.log("[8a] 已更新 deployments/conet-ConetTreasury.json bUnitAirdrop");
  }

  // 8. deployCardFactoryOnlyWithSettleAdmin / redeployCardFactoryAndUpdateConfig 回退地址
  for (const scriptName of ["deployCardFactoryOnlyWithSettleAdmin.ts", "redeployCardFactoryAndUpdateConfig.ts"]) {
    const scriptPath = path.join(__dirname, "..", "scripts", scriptName);
    if (fs.existsSync(scriptPath)) {
      let content = fs.readFileSync(scriptPath, "utf-8");
      if (content.includes("CONET_BUNIT_AIRDROP")) {
        content = content.replace(
          /CONET_BUNIT_AIRDROP\s*=\s*["'](0x[a-fA-F0-9]{40})["']/,
          `CONET_BUNIT_AIRDROP = "${bunitAirdrop}"`
        );
        fs.writeFileSync(scriptPath, content);
        console.log(`[8] 已更新 scripts/${scriptName}`);
      }
    }
  }

  // 9. conetUsdc 引用更新
  if (conetUsdc) {
    // 9a. .cursor/rules/conet-deployments.mdc conet-USDC
    if (fs.existsSync(rulesPath)) {
      let content = fs.readFileSync(rulesPath, "utf-8");
      content = content.replace(
        /(conet-USDC[^`]*)`0x[a-fA-F0-9]{40}`([^\n]*)/,
        `$1\`${conetUsdc}\`$2`
      );
      fs.writeFileSync(rulesPath, content);
      console.log("[9a] 已更新 .cursor/rules/conet-deployments.mdc conet-USDC");
    }
    // 9b. src/b-unit/readme.md USDC (FactoryERC20) 表格行
    if (fs.existsSync(readmePath)) {
      let content = fs.readFileSync(readmePath, "utf-8");
      content = content.replace(
        /\|\s*\*\*USDC\*\*\s*\(FactoryERC20\)\s*\|\s*`0x[a-fA-F0-9]{40}`/,
        `| **USDC** (FactoryERC20) | \`${conetUsdc}\``
      );
      fs.writeFileSync(readmePath, content);
      console.log("[9b] 已更新 src/b-unit/readme.md USDC");
    }
    // 9c. scripts/consumeBUnitFromUser.ts 回退地址
    const consumePath = path.join(__dirname, "..", "scripts", "consumeBUnitFromUser.ts");
    if (fs.existsSync(consumePath)) {
      let content = fs.readFileSync(consumePath, "utf-8");
      content = content.replace(
        /return d\.conetUsdc \|\| "0x[a-fA-F0-9]{40}"/,
        `return d.conetUsdc || "${conetUsdc}"`
      );
      content = content.replace(
        /return "0x[a-fA-F0-9]{40}";(\s*\})/,
        `return "${conetUsdc}";$1`
      );
      fs.writeFileSync(consumePath, content);
      console.log("[9c] 已更新 scripts/consumeBUnitFromUser.ts");
    }
    // 9d. scripts/linkRedeployedBUnitAirdropToConet.ts 回退地址
    const linkPath = path.join(__dirname, "..", "scripts", "linkRedeployedBUnitAirdropToConet.ts");
    if (fs.existsSync(linkPath)) {
      let content = fs.readFileSync(linkPath, "utf-8");
      content = content.replace(
        /(CONET_USDC = fs\.existsSync\(ADDRESSES_PATH\)\s*\?\s*JSON\.parse\(fs\.readFileSync\(ADDRESSES_PATH,\s*"utf-8"\)\)\.conetUsdc\s*:\s*)"0x[a-fA-F0-9]{40}"/,
        `$1"${conetUsdc}"`
      );
      fs.writeFileSync(linkPath, content);
      console.log("[9d] 已更新 scripts/linkRedeployedBUnitAirdropToConet.ts");
    }
    // 9e. API server util.ts CONET_USDC_ADDRESS（若存在）
    const apiUtilPath = path.join(__dirname, "..", "scripts", "API server", "util.ts");
    if (fs.existsSync(apiUtilPath)) {
      let content = fs.readFileSync(apiUtilPath, "utf-8");
      if (content.includes("CONET_USDC_ADDRESS")) {
        content = content.replace(
          /CONET_USDC_ADDRESS\s*=\s*['"](0x[a-fA-F0-9]{40})['"]/,
          `CONET_USDC_ADDRESS = '${conetUsdc}'`
        );
        fs.writeFileSync(apiUtilPath, content);
        console.log("[9e] 已更新 scripts/API server/util.ts CONET_USDC_ADDRESS");
      }
    }
  }

  console.log("\n✅ 引用更新完成");
}

main();
