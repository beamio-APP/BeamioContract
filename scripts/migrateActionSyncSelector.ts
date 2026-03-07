/**
 * 迁移 ActionFacet 的全部 selectors 到最新实现（Add/Replace）
 *
 * 用法:
 *   npx hardhat run scripts/migrateActionSyncSelector.ts --network conet
 *   DIAMOND_ADDRESS=0x... npx hardhat run scripts/migrateActionSyncSelector.ts --network conet
 */

import { network as hreNetwork } from "hardhat";
import { ethers as ethersLib } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDiamondAddressFromDeployment(): string {
  const env = process.env.DIAMOND_ADDRESS;
  if (env) return env;
  const deployPath = path.join(__dirname, "..", "deployments", "conet-IndexerDiamond.json");
  if (!fs.existsSync(deployPath)) throw new Error("未找到 deployments/conet-IndexerDiamond.json，请设置 DIAMOND_ADDRESS");
  const deploy = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  if (!deploy.diamond) throw new Error("deployments/conet-IndexerDiamond.json 缺少 diamond 字段");
  return deploy.diamond as string;
}

async function main() {
  const { ethers } = (await hreNetwork.connect()) as any;
  const [signer] = await ethers.getSigners();
  const diamond = getDiamondAddressFromDeployment();

  console.log("迁移 ActionFacet 全量 selectors");
  console.log("Signer:", signer.address);
  console.log("Diamond:", diamond);

  const ActionFacet = await ethers.getContractFactory("ActionFacet");
  const actionFacet = await ActionFacet.deploy();
  await actionFacet.waitForDeployment();
  const actionFacetAddr = await actionFacet.getAddress();
  console.log("New ActionFacet:", actionFacetAddr);

  const selectors = [...new Set(
    ActionFacet.interface.fragments
      .filter((f: any) => f.type === "function")
      .map((f: any) => f.selector.toLowerCase())
  )];
  console.log("ActionFacet selectors:", selectors.length);

  const diamondCutAbi = [
    "function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata) external",
  ];
  const loupeAbi = ["function facetAddress(bytes4 _functionSelector) external view returns (address facetAddress)"];
  const diamondCut = new ethersLib.Contract(diamond, diamondCutAbi, signer);
  const loupe = new ethersLib.Contract(diamond, loupeAbi, signer);
  const toAdd: string[] = [];
  const toReplace: string[] = [];

  for (const selector of selectors) {
    const existingFacet = (await loupe.facetAddress(selector)).toLowerCase();
    if (existingFacet === ethersLib.ZeroAddress.toLowerCase()) {
      toAdd.push(selector);
    } else {
      toReplace.push(selector);
    }
  }

  console.log("toAdd:", toAdd.length, "toReplace:", toReplace.length);
  const cuts: { facetAddress: string; action: number; functionSelectors: string[] }[] = [];
  if (toAdd.length) {
    cuts.push({
      facetAddress: actionFacetAddr,
      action: 0,
      functionSelectors: toAdd,
    });
  }
  if (toReplace.length) {
    cuts.push({
      facetAddress: actionFacetAddr,
      action: 1,
      functionSelectors: toReplace,
    });
  }

  if (!cuts.length) {
    console.log("没有需要迁移的 selectors");
    return;
  }

  const tx = await diamondCut.diamondCut(cuts, ethersLib.ZeroAddress, "0x");
  console.log("diamondCut tx:", tx.hash);
  await tx.wait();
  console.log("✅ ActionFacet 已迁移");

  const deployPath = path.join(__dirname, "..", "deployments", "conet-IndexerDiamond.json");
  if (fs.existsSync(deployPath)) {
    const data = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
    data.facets = data.facets || {};
    data.facets.ActionFacet = actionFacetAddr;
    data.lastActionFacetMigrationAt = new Date().toISOString();
    fs.writeFileSync(deployPath, JSON.stringify(data, null, 2));
    console.log("已更新部署文件:", deployPath);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

