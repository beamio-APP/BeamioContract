/**
 * 诊断 Base 链上 BUnitPurchased 交易，验证 miner 为何未投票。
 * 用法: npx hardhat run scripts/diagnoseBUnitPurchasedTx.ts --network base
 *
 * Tx: 0x9e6f9ac9881b4e992769b403061d1365d077eacf2f35e48689316f305b36a1b5
 * BaseTreasury: 0x5c64a8b0935DA72d60933bBD8cD10579E1C40c58
 */

import { network } from "hardhat";

const BASE_TREASURY = "0x5c64a8b0935DA72d60933bBD8cD10579E1C40c58";
const TX_HASH = "0x9e6f9ac9881b4e992769b403061d1365d077eacf2f35e48689316f305b36a1b5";

async function main() {
  const { ethers } = await network.connect();
  const bunitIface = new ethers.Interface([
    "event BUnitPurchased(address indexed user, address indexed usdc, uint256 amount)",
  ]);
  const BUNIT_PURCHASED_TOPIC = bunitIface.getEvent("BUnitPurchased")?.topicHash ?? "0x";
  const provider = ethers.provider;

  console.log("=".repeat(70));
  console.log("BUnitPurchased 交易诊断");
  console.log("=".repeat(70));
  console.log("Tx hash:", TX_HASH);
  console.log("BaseTreasury:", BASE_TREASURY);
  console.log("");

  const receipt = await provider.getTransactionReceipt(TX_HASH);
  if (!receipt) {
    console.log("❌ 无法获取交易 receipt，可能 hash 错误或网络问题");
    return;
  }

  console.log("--- 交易信息 ---");
  console.log("Status:", receipt.status === 1 ? "成功" : "失败");
  console.log("Block:", receipt.blockNumber);
  console.log("To:", receipt.to);
  console.log("");

  const logs = receipt.logs.filter(
    (l) => l.address.toLowerCase() === BASE_TREASURY.toLowerCase() && l.topics[0] === BUNIT_PURCHASED_TOPIC
  );

  console.log("--- BUnitPurchased 事件 ---");
  if (logs.length === 0) {
    console.log("❌ 未找到 BUnitPurchased 事件");
    console.log("   receipt.logs 数量:", receipt.logs.length);
    receipt.logs.forEach((l, i) => {
      console.log(`   log[${i}] address=${l.address} topics[0]=${l.topics[0]?.slice(0, 18)}...`);
    });
  } else {
    for (const log of logs) {
      const parsed = bunitIface.parseLog({ data: log.data, topics: log.topics as string[] });
      if (parsed) {
        const { user, usdc, amount } = parsed.args;
        console.log("✓ 找到 BUnitPurchased:", { user, usdc, amount: amount.toString(), txHash: receipt.hash });
      }
    }
  }

  console.log("");
  console.log("--- eth_getLogs 模拟（CoNET-SI poller 使用的查询）---");
  const fromBlock = receipt.blockNumber;
  const toBlock = receipt.blockNumber;
  const pollerLogs = await provider.getLogs({
    address: BASE_TREASURY,
    topics: [BUNIT_PURCHASED_TOPIC],
    fromBlock: BigInt(fromBlock),
    toBlock: BigInt(toBlock),
  });
  console.log("getLogs(fromBlock=" + fromBlock + ", toBlock=" + toBlock + ") 返回:", pollerLogs.length, "条");
  if (pollerLogs.length > 0) {
    console.log("  txHash:", pollerLogs[0].transactionHash);
  }

  console.log("");
  console.log("--- 可能原因 ---");
  console.log("1. CoNET-SI 节点不是 ConetTreasury miner -> poller 未启动");
  console.log("2. BASE_RPC_HTTP / BASE_RPC 配置的 RPC 与当前网络不一致");
  console.log("3. poller 启动时 lastBlock 已超过该交易所在 block，导致漏扫");
  console.log("4. RPC 限流或 eth_getLogs 返回空");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
