# SilentPassUI Oracle 价格来源检查报告

## 1. 数据流概览

```
SilentPassUI (getOracle)
    ↓ fetch
https://beamio.app/api/getOracle
    ↓ 
Beamio 后端 (Cluster) → 每约 1 分钟从 Master 拉取
    ↓
Master (x402sdk) → oracolPrice() 从链上读取
    ↓
Base 主网 BeamioOracle 合约 (0xDa4AE8301262BdAaf1bb68EC91259E6C512A9A2B)
    → getRate(uint8 currency) 返回 E18 汇率
```

## 2. 价格来源

| 层级 | 位置 | 说明 |
|------|------|------|
| **前端** | `beamio.ts` L269 | `getOracle()` fetch `${beamioApi}/api/getOracle` |
| **API 端点** | `beamio.app/api/getOracle` | Beamio 线上服务 |
| **后端 Master** | `x402sdk/src/util.ts` L202-232 | `oracolPrice()` 调用 `oracleSCBase.getRate(0..8)` |
| **链上 Oracle** | Base 主网 `0xDa4AE8301262BdAaf1bb68EC91259E6C512A9A2B` | BeamioOracle 合约 `getRate(uint8)` |

## 3. BeamioOracle 合约语义

- **getRate(currency)**: 返回「1 单位该货币 = X USD」的 E18 值  
  例：`getRate(CAD)` ≈ 0.74e18 → 1 CAD ≈ 0.74 USD  

- **BeamioCurrency 枚举**: CAD=0, USD=1, JPY=2, CNY=3, USDC=4, HKD=5, EUR=6, SGD=7, TWD=8  

## 4. 潜在问题：语义不一致

**链上返回**: `1 外币 = X USD`（如 1 CAD = 0.74 USD）  
**前端预期**: `1 USD = X 外币`（如 1 USD = 1.35 CAD），用于 `currencyToUsdcAmount = cur / u2c / u2u`

当前 oracolPrice 直接赋值：
```ts
oracle.usdcad = getRate(0)  // 0.74
```

若前端按 `1 USD = usdcad CAD` 使用，则 100 CAD 会被算成 `100/0.74 ≈ 135 USDC`，而正确应为 `100 * 0.74 = 74 USDC`。

**正确转换应为**: 对非 USD 货币做倒数  
- `usdcad = 1 / getRate(CAD)` → ≈ 1.35  
- `usdjpy = 1 / getRate(JPY)` → ≈ 150  
- 等等

USDC 和 USD 保持不变：`usdc = getRate(USDC)` ≈ 1。

## 5. 涉及文件

- `src/SilentPassUI/src/services/beamio.ts`：getOracle、getOraclesEndPoint
- `src/x402sdk/src/util.ts`：oracolPrice、oracleSCBase.getRate
- `src/x402sdk/src/endpoint/beamioServer.ts`：getOracle 路由、clusterOracleCache
- `src/x402sdk/src/endpoint/beamioMaster.ts`：oracleForCluster
- `scripts/API server/util.ts`：旧版 GuardianOracle（Conet）与 BeamioOracle（Base）混用逻辑

## 6. 建议

1. 在 `x402sdk/util.ts` 的 `oracolPrice` 中，对 CAD/JPY/CNY/HKD/EUR/SGD/TWD 使用 `1 / getRate(c)`，USDC 和 USD 保持原样。  
2. 核实 beamio.app 线上实际使用的后端版本（Master/Cluster vs scripts/API server）。  
3. 增加 Oracle 数据与 Coinbase/Chainlink 等参考价格的定期对比与告警。
