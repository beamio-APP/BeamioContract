/**
 * 将 settle_contractAdmin 添加为已部署 CCSA 卡的 admin
 * 需卡 owner 私钥调用 addAdmin
 *
 * 用法:
 *   CCSA_CARD=0x6700cA6ff47c75dcF7362aa64Ed9C56E1242b508 CARD_OWNER_PK=<owner私钥> npx hardhat run scripts/addSettleAdminsToCCSACard.ts --network base
 */
import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASTER_PATH = path.join(homedir(), ".master.json");

function loadMasterSetup(): { settle_contractAdmin: string[] } {
  if (!fs.existsSync(MASTER_PATH)) {
    throw new Error("未找到 ~/.master.json，请配置 settle_contractAdmin");
  }
  const data = JSON.parse(fs.readFileSync(MASTER_PATH, "utf-8"));
  if (!data.settle_contractAdmin || !Array.isArray(data.settle_contractAdmin) || data.settle_contractAdmin.length === 0) {
    throw new Error("~/.master.json 中 settle_contractAdmin 为空或不是数组");
  }
  return {
    settle_contractAdmin: data.settle_contractAdmin.map((pk: string) => (pk.startsWith("0x") ? pk : `0x${pk}`)),
  };
}

async function main() {
  const { ethers } = await networkModule.connect();

  const cardAddress = process.env.CCSA_CARD;
  if (!cardAddress || !ethers.isAddress(cardAddress)) {
    throw new Error("请设置 CCSA_CARD=0x... 环境变量");
  }

  const ownerPk = process.env.CARD_OWNER_PK;
  if (!ownerPk) {
    throw new Error("请设置 CARD_OWNER_PK（CCSA 卡 owner 私钥）");
  }

  const master = loadMasterSetup();
  const adminAddresses = master.settle_contractAdmin.map((pk: string) => new ethers.Wallet(pk).address);

  const provider = ethers.provider;
  const adminSigner = new ethers.Wallet(ownerPk.startsWith("0x") ? ownerPk : `0x${ownerPk}`, provider);

  const userCard = await ethers.getContractAt("BeamioUserCard", cardAddress, adminSigner);
  const cardOwner = await userCard.owner();
  if (adminSigner.address.toLowerCase() !== cardOwner.toLowerCase()) {
    throw new Error(`CARD_OWNER_PK 对应 ${adminSigner.address}，与卡 owner ${cardOwner} 不一致`);
  }

  console.log("CCSA 卡:", cardAddress);
  console.log("Owner:", cardOwner);
  console.log("待添加 admin 数:", adminAddresses.length);

  for (let i = 0; i < adminAddresses.length; i++) {
    const addr = adminAddresses[i];
    const already = await userCard.isAdmin(addr);
    if (already) {
      console.log(`  [${i + 1}] ${addr} 已是 admin，跳过`);
      continue;
    }
    const currentCount = (await userCard.adminList()).length;
    const newThreshold = currentCount + 1;
    const tx = await userCard.addAdmin(addr, newThreshold);
    console.log(`  [${i + 1}] addAdmin(${addr}) tx: ${tx.hash}`);
    await tx.wait();
    console.log(`     ✅ 已添加`);
  }
  console.log("\n✅ 全部完成");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
