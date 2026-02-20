# BeamioIndexerDiamond 数据结构审视报告

对照《交易历史模块 (Transactions History) 开发规格说明书》v1.0，对 BeamioIndexerDiamond 的数据结构进行审视。

---

## 1. 规格说明书中的 Transaction 接口

前端 BeamioTransactions 需要的标准化交易对象：

| 字段 | 规格要求 | 用途 |
|------|----------|------|
| id, type, title, handle, timestamp | 必填 | 列表展示、分类 |
| amountFiat, currencyFiat, amountUSDC | 必填 | 金额显示（法币 + USDC） |
| status, category, accountType | 必填 | 状态、Tab 过滤 (Cash/Vouchers/All) |
| isMixed, route[] | 混合支付 | Smart Routing 可视化 |
| fees { gas, service, bUnits } | V6.0 燃料模型 | 费用展示、request_create 燃料消耗 |
| hashes { base, conet } | 双链证明 | 结算链 + 数据链存证 |
| meta | 可选 | 原始请求金额、requestId 关联 |

**TransactionType 枚举**：merchant_pay, transfer_in, transfer_out, topup, internal_transfer, voucher_burn, request_create, request_fulfilled, request_expired

---

## 2. 当前 Diamond 存储结构概览

| 存储库 | 核心结构 | 职责 |
|--------|----------|------|
| LibTaskStorage | Task, Whitelist | 治理多签任务、卡白名单 |
| LibStatsStorage | HourlyStats | 按小时聚合 (nftMinted, tokenMinted, tokenBurned, transferCount) |
| LibActionStorage | Action, ActionMeta | Token mint/burn/transfer 动作 |
| LibCatalogStorage | CardMeta | 卡集合元数据 |
| LibCatalogStatsStorage | HourlyCatalogStats | 卡注册/上下架等聚合 |

---

## 3. Action vs Transaction 映射分析

**LibActionStorage.Action** 与规格 Transaction 的对应关系：

| 规格字段 | Action/ActionMeta 现状 | 结论 |
|----------|------------------------|------|
| **id** | actionId (index) | ✅ 有 |
| **type** | actionType (1 mint, 2 burn, 3 transfer) | ⚠️ 仅 3 种，缺 merchant_pay、transfer_in/out、request_*、topup 等 |
| **title, handle** | ActionMeta.title, note | ⚠️ 有 title，无 handle |
| **timestamp** | Action.timestamp | ✅ 有 |
| **amountFiat, currencyFiat** | 无 | ❌ 缺失 |
| **amountUSDC** | Action.amount（points） | ⚠️ 仅 points 数量，无 USDC 对应 |
| **status** | 无 | ❌ 无 Finalized/Waiting/Received/Expired |
| **category** | 无 | ❌ 无 |
| **accountType** | 无 | ❌ 无 EOA/AA 区分 |
| **isMixed, route** | 无 | ❌ 无混合支付路由 |
| **fees** | ActionMeta: tax, tip, beamioFee1/2, cardServiceFee | ⚠️ 结构不同，缺 gas、bUnits |
| **hashes** | 无 | ❌ 无 base/conet 双链哈希 |
| **meta** | 无 | ❌ 无 requestAmount、originalRequestId |

---

## 4. 合理性评估

### 4.1 职责边界

- **当前定位**：BeamioIndexerDiamond 主要服务 **CoNET L1 上的 Card/Points 业务**：
  - Task：跨链治理、白名单
  - Action：$CCSA / Points 的 mint/burn/transfer
  - Catalog：卡集合元数据
- **规格定位**：交易历史是 **双链数据融合**：Base L2（结算、USDC）+ CoNET L1（社交、B-Units）

结论：Diamond 与规格在职责上存在明显错位，前者偏 Card 业务与治理，后者需要统一的 C 端交易流水视图。

### 4.2 结构性缺口

1. **交易类型不足**：Action 仅有 mint/burn/transfer，无法表达：
   - merchant_pay（B 扫 C、C 扫 B）
   - transfer_in / transfer_out（P2P USDC）
   - topup / internal_transfer（EOA↔AA）
   - request_create / request_fulfilled / request_expired（请求生命周期）

2. **双链与结算信息缺失**：
   - 无 `hashes.base`（Base 结算 tx hash）
   - 无 `hashes.conet`（CoNET 存证 hash）
   - 无 `accountType`（EOA vs AA）

3. **费用模型不一致**：
   - 规格：`fees { gas, service, bUnits }`，且 request_create 消耗 B-Units
   - 现状：ActionMeta 有税、小费、平台费等，无 gas、bUnits

4. **混合支付与路由缺失**：
   - 规格要求 `isMixed`、`route[]` 做 Smart Routing 展示
   - 当前结构无法表达 USDC + $CCSA 的组合支付

---

## 5. 建议方向

### 5.1 架构分层（推荐）

| 层级 | 职责 | 实现方式 |
|------|------|----------|
| **Base L2** | USDC 结算、EOA/AA 资金流 | 链上事件 + 链下 Indexer 扫描 |
| **CoNET L1** | B-Units 消耗、社交/存证 | 链上事件 + 本 Diamond |
| **统一层** | 聚合、标准化 Transaction | 后端/GraphQL 合并 Base + CoNET + Diamond 数据 |

Diamond 保持为 **CoNET 侧权威数据源**，不强行承载完整 Transaction 结构。

### 5.2 若需在链上承载更多交易信息

可考虑扩展 Action 或新增 Transaction 结构，例如：

```solidity
// 示例：扩展示意（非必须）
struct TransactionRecord {
    uint8 txType;       // 对应 TransactionType 枚举
    uint8 status;       // Finalized/Waiting/Received/Expired
    uint8 accountType;  // EOA=0, AA=1
    address from;
    address to;
    uint256 amountUSDC; // 6 decimals
    uint256 amountFiatE8;
    uint8 currencyFiat;
    uint256 bUnitsSpent;
    bytes32 hashBase;   // Base L2 tx hash (0 = null)
    bytes32 hashConet;  // CoNET L1 tx hash
    bool isMixed;
    // route 等复杂结构可用 bytes 或 separate 表
}
```

注意：链上存储大量 string 和复杂结构成本高，需权衡。

### 5.3 建议结论

| 项目 | 评估 |
|------|------|
| **Task / Catalog / Stats** | ✅ 与 Card 治理、元数据、统计需求匹配 |
| **Action** | ⚠️ 可覆盖部分 voucher 相关交易，无法覆盖完整 Transaction 规格 |
| **与规格契合度** | 约 30–40%，主要缺失：交易类型、双链哈希、账户类型、混合支付、费用模型 |

**推荐**：维持 Diamond 当前结构，作为 CoNET 侧数据源；由 **链下 Indexer 或后端服务** 负责聚合 Base + CoNET + Diamond，输出符合规格的 Transaction 列表给前端。
