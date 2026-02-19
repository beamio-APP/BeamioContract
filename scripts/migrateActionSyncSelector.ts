/**
 * 仅迁移 ActionFacet 的 syncTokenAction selector 到最新实现
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

  console.log("迁移 syncTokenAction selector");
  console.log("Signer:", signer.address);
  console.log("Diamond:", diamond);

  const ActionFacet = await ethers.getContractFactory("ActionFacet");
  const actionFacet = await ActionFacet.deploy();
  await actionFacet.waitForDeployment();
  const actionFacetAddr = await actionFacet.getAddress();
  console.log("New ActionFacet:", actionFacetAddr);

  const iface = ActionFacet.interface;
  const syncSelector = iface.getFunction("syncTokenAction")!.selector.toLowerCase();
  console.log("syncTokenAction selector:", syncSelector);

  const diamondCutAbi = [
    "function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata) external",
  ];
  const loupeAbi = ["function facetAddress(bytes4 _functionSelector) external view returns (address facetAddress)"];
  const diamondCut = new ethersLib.Contract(diamond, diamondCutAbi, signer);
  const loupe = new ethersLib.Contract(diamond, loupeAbi, signer);
  const existingFacet = (await loupe.facetAddress(syncSelector)).toLowerCase();
  const action = existingFacet === ethersLib.ZeroAddress.toLowerCase() ? 0 : 1; // Add or Replace
  console.log("syncTokenAction 当前 Facet:", existingFacet);
  console.log("diamondCut action:", action === 0 ? "Add" : "Replace");
  const cuts = [
    {
      facetAddress: actionFacetAddr,
      action,
      functionSelectors: [syncSelector],
    },
  ];

  const tx = await diamondCut.diamondCut(cuts, ethersLib.ZeroAddress, "0x");
  console.log("diamondCut tx:", tx.hash);
  await tx.wait();
  console.log("✅ syncTokenAction 已迁移");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

