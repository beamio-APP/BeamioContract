/**
 * 验证已部署的 BeamioUserCard 合约合格性（getRedeemStatus / getRedeemStatusBatch 返回 totalPoints6）
 * 运行：CARD_ADDRESS=0x... npx hardhat run scripts/verifyDeployedUserCard.ts --network base
 */
import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const addr = process.env.CARD_ADDRESS || "";
  if (!addr || !ethers.isAddress(addr)) {
    console.log("❌ 请设置 CARD_ADDRESS 环境变量");
    process.exit(1);
  }

  const cardAbi = [
    "function getRedeemStatus(bytes32 hash) view returns (bool active, uint256 totalPoints6)",
    "function getRedeemStatusBatch(bytes32[] hashes) view returns (bool[] active, uint256[] totalPoints6)",
    "function factoryGateway() view returns (address)",
  ];
  const card = new ethers.Contract(addr, cardAbi, ethers.provider);
  const testHash = ethers.keccak256(ethers.toUtf8Bytes("_verify_"));

  console.log("========== BeamioUserCard 合格性检查 ==========");
  console.log("合约地址:", addr);

  const [active, totalPoints6] = await card.getRedeemStatus(testHash);
  console.log("\n1. getRedeemStatus(bytes32):");
  console.log("   active:", active, ", totalPoints6:", totalPoints6.toString(), "(类型:", typeof totalPoints6 + ")");
  if (typeof totalPoints6 === "bigint") {
    console.log("   ✅ 返回 uint256 totalPoints6");
  } else {
    console.log("   ❌ totalPoints6 类型异常");
  }

  const [activeList, totalList] = await card.getRedeemStatusBatch([testHash]);
  console.log("\n2. getRedeemStatusBatch(bytes32[]):");
  console.log("   active[0]:", activeList[0], ", totalPoints6[0]:", totalList[0].toString());
  if (Array.isArray(totalList) && totalList.length === 1) {
    console.log("   ✅ 返回 uint256[] totalPoints6");
  }

  const gateway = await card.factoryGateway();
  console.log("\n3. factoryGateway():", gateway);
  if (gateway && gateway !== ethers.ZeroAddress) {
    console.log("   ✅ 已连接 Factory");
  }

  console.log("\n========== 合格性检查通过 ==========");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
