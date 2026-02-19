/**
 * 迁移 BeamioIndexerDiamond 查询 selector：
 * - FeeStatsFacet
 * - BeamioUserCardStatsFacet
 *
 * 用法:
 *   npx hardhat run scripts/migrateIndexerFacetsToSplitStats.ts --network conet
 *   DIAMOND_ADDRESS=0x... npx hardhat run scripts/migrateIndexerFacetsToSplitStats.ts --network conet
 */

import { network as hreNetwork } from "hardhat";
import { ethers as ethersLib } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIAMOND_CUT_SELECTOR = "0x1f931c1c";

function getSelectors(abi: any): string[] {
  const arr = Array.isArray(abi) ? abi : abi?.abi || abi;
  if (!Array.isArray(arr)) throw new Error("Bad ABI");
  return [
    ...new Set(
      arr
        .filter((f: any) => f.type === "function")
        .map((f: any) =>
          ethersLib.id(`${f.name}(${(f.inputs || []).map((i: any) => i.type).join(",")})`).slice(0, 10).toLowerCase()
        )
    ),
  ].filter((s) => s !== DIAMOND_CUT_SELECTOR);
}

function getDiamondAddressFromDeployment(): string {
  const env = process.env.DIAMOND_ADDRESS;
  if (env) return env;

  const deployPath = path.join(__dirname, "..", "deployments", "conet-IndexerDiamond.json");
  if (!fs.existsSync(deployPath)) {
    throw new Error("未找到 deployments/conet-IndexerDiamond.json，请设置 DIAMOND_ADDRESS");
  }
  const deploy = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  if (!deploy.diamond) throw new Error("deployments/conet-IndexerDiamond.json 缺少 diamond 字段");
  return deploy.diamond as string;
}

async function main() {
  const { ethers } = await hreNetwork.connect();
  const [signer] = await ethers.getSigners();
  const diamond = getDiamondAddressFromDeployment();

  console.log("=".repeat(60));
  console.log("迁移 Diamond selectors -> FeeStatsFacet / BeamioUserCardStatsFacet");
  console.log("=".repeat(60));
  console.log("Signer:", signer.address);
  console.log("Diamond:", diamond);

  const FeeStatsFacet = await ethers.getContractFactory("FeeStatsFacet");
  const feeStatsFacet = await FeeStatsFacet.deploy();
  await feeStatsFacet.waitForDeployment();
  const feeStatsFacetAddr = await feeStatsFacet.getAddress();
  console.log("FeeStatsFacet:", feeStatsFacetAddr);

  const CardStatsFacet = await ethers.getContractFactory("BeamioUserCardStatsFacet");
  const cardStatsFacet = await CardStatsFacet.deploy();
  await cardStatsFacet.waitForDeployment();
  const cardStatsFacetAddr = await cardStatsFacet.getAddress();
  console.log("BeamioUserCardStatsFacet:", cardStatsFacetAddr);

  const artifactsRoot = path.join(__dirname, "..", "artifacts", "src", "CoNETIndexTaskdiamond");
  const feeArtifact = JSON.parse(
    fs.readFileSync(path.join(artifactsRoot, "facets", "FeeStatsFacet.sol", "FeeStatsFacet.json"), "utf-8")
  );
  const cardArtifact = JSON.parse(
    fs.readFileSync(
      path.join(artifactsRoot, "facets", "BeamioUserCardStatsFacet.sol", "BeamioUserCardStatsFacet.json"),
      "utf-8"
    )
  );

  const feeSelectors = getSelectors(feeArtifact.abi);
  const cardSelectors = getSelectors(cardArtifact.abi);

  const loupeAbi = [
    "function facets() external view returns (tuple(address facetAddress, bytes4[] functionSelectors)[])",
  ];
  const loupe = new ethersLib.Contract(diamond, loupeAbi, signer);
  const facets = await loupe.facets();
  const existing = new Set<string>();
  for (const f of facets as any[]) {
    const selectors: string[] = f[1] || [];
    for (const sel of selectors) {
      existing.add(sel.toLowerCase());
    }
  }

  const classifySelectors = async (selectors: string[]) => {
    const toAdd: string[] = [];
    const toReplace: string[] = [];
    for (const s of selectors) {
      if (existing.has(s.toLowerCase())) toReplace.push(s);
      else toAdd.push(s);
    }
    return { toAdd, toReplace };
  };

  const feeClassify = await classifySelectors(feeSelectors);
  const cardClassify = await classifySelectors(cardSelectors);

  const cuts: { facetAddress: string; action: number; functionSelectors: string[] }[] = [];

  if (feeClassify.toAdd.length) {
    cuts.push({ facetAddress: feeStatsFacetAddr, action: 0, functionSelectors: feeClassify.toAdd });
  }
  if (feeClassify.toReplace.length) {
    cuts.push({ facetAddress: feeStatsFacetAddr, action: 1, functionSelectors: feeClassify.toReplace });
  }
  if (cardClassify.toAdd.length) {
    cuts.push({ facetAddress: cardStatsFacetAddr, action: 0, functionSelectors: cardClassify.toAdd });
  }
  if (cardClassify.toReplace.length) {
    cuts.push({ facetAddress: cardStatsFacetAddr, action: 1, functionSelectors: cardClassify.toReplace });
  }

  if (cuts.length === 0) {
    console.log("没有需要迁移的 selectors");
    return;
  }

  const diamondCutAbi = [
    "function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata) external",
  ];
  const diamondCut = new ethersLib.Contract(diamond, diamondCutAbi, signer);

  console.log("准备执行 cuts:");
  for (const c of cuts) {
    console.log(` - action=${c.action} facet=${c.facetAddress} selectors=${c.functionSelectors.length}`);
  }

  const tx = await diamondCut.diamondCut(cuts, ethersLib.ZeroAddress, "0x");
  console.log("diamondCut tx:", tx.hash);
  await tx.wait();
  console.log("✅ 迁移完成");

  const deployPath = path.join(__dirname, "..", "deployments", "conet-IndexerDiamond.json");
  if (fs.existsSync(deployPath)) {
    const data = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
    data.facets = data.facets || {};
    data.facets.FeeStatsFacet = feeStatsFacetAddr;
    data.facets.BeamioUserCardStatsFacet = cardStatsFacetAddr;
    data.lastSelectorMigrationAt = new Date().toISOString();
    fs.writeFileSync(deployPath, JSON.stringify(data, null, 2));
    console.log("已更新部署文件:", deployPath);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

