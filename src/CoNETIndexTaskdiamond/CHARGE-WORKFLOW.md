# Charge 工作流程：Android 自组织 Container + 服务端签名 Relay

## 架构概览

- **Android**：根据 UID 的 CCSA 卡、基础设施卡、USDC 余额，自行 Smart Routing 构建 container 结构
- **服务端**：接受 Android 打包的未签名 container，用 UID 私钥签名后 relay 上链

## 流程

```
Android                          服务端
   |                                |
   | 1. getUIDAssets(uid)          |
   | ----------------------------->| 返回 cards, usdcBalance, aaAddress
   |<----------------------------- |
   |                                |
   | 2. payByNfcUidPrepare(uid, payee, amountUsdc6)
   | ----------------------------->| 返回 account, nonce, deadline, payeeAA, unitPriceUSDC6
   |<----------------------------- |
   |                                |
   | 3. Smart Routing（本地）        |
   |    - 聚合 CCSA 卡 points6       |
   |    - 计算 ccsaPointsWei, usdcWei |
   |    - 构建 items (kind 0=USDC, 1=CCSA) |
   |                                |
   | 4. payByNfcUidSignContainer(uid, containerPayload, amountUsdc6)
   | ----------------------------->| 用 UID 私钥签名，push ContainerRelayPool
   |                                | ContainerRelayProcess 执行 relay
   |<----------------------------- | 返回 success, USDC_tx
```

## API 说明

### 1. getUIDAssets（已有，增强）

- **POST** `/api/getUIDAssets`
- **Body**: `{ uid }`
- **返回**：新增 `aaAddress`（AA 地址，供构建 container 使用）

### 2. payByNfcUidPrepare（新增）

- **POST** `/api/payByNfcUidPrepare`
- **Body**: `{ uid, payee, amountUsdc6 }`
- **返回**:
  - `ok`: boolean
  - `account`: AA 地址
  - `nonce`: container nonce
  - `deadline`: 过期时间戳
  - `payeeAA`: 收款方 AA（若 payee 为 EOA 则已解析）
  - `unitPriceUSDC6`: CCSA 1e6 points 的 USDC6 单价（用于 Smart Routing）

### 3. payByNfcUidSignContainer（新增）

- **POST** `/api/payByNfcUidSignContainer`
- **Body**: `{ uid, containerPayload, amountUsdc6 }`
- **containerPayload**（未签名）:
  - `account`: AA 地址
  - `to`: 收款方 AA
  - `items`: `[{ kind, asset, amount, tokenId, data }, ...]`
  - `nonce`, `deadline`
- **逻辑**：服务端用 UID 私钥对 container 签名，push 到 ContainerRelayPool，由 ContainerRelayProcess 执行 relay
- **返回**：与 payByNfcUid 一致，`{ success, USDC_tx }` 或 `{ success: false, error }`

## Smart Routing 扣款逻辑（参照 SilentPassUI）

- **items 顺序**：USDC (kind 0)、CCSA (kind 1)、基础设施 (kind 1)
- **可扣款卡**：CCSA + 基础设施 (CashTrees)，`chargeableCards` 包含 `cardType == "ccsa"` 或 `"infrastructure"`
- **余额校验**：`totalBalance6 = ccsaValueUsdc6 + infraValueUsdc6 + usdcBalance6 >= amountUsdc6`
- **分配**：优先用 CCSA 点数，其次基础设施点数，不足部分用 USDC

## 金额与币种转换（Oracle）

- **用户输入**：Android 输入为 CAD
- **转换**：调用 `GET /api/getOracle` 获取 `usdcad`、`usdeur`、`usdjpy` 等汇率，按扣款卡 `cardCurrency` 或 USDC 进行折算
- **CAD → USDC6**：`amountUsdc6 = amountCad / usdcad * 1e6`
- **余额折算**：各卡 `points6` 按 `cardCurrency` 使用对应 oracle 汇率折算为 USDC6（CAD→usdcad，USD/USDC→1.0，EUR→usdeur 等）

## 余额预检（Cluster 预检，Master 信任）

- **Android**：构建 container 前本地校验余额，不足时显示「余额不足」错误
- **Cluster**：`payByNfcUidSignContainer` 请求前校验 account 的 USDC 与 CCSA 点数是否满足 items；不足则返回 400 `{ success: false, error: '余额不足' }`，不转发 Master
- **Master**：不做余额校验，仅用 UID 私钥签名并 relay 上链

## 文件变更

- **x402sdk/MemberCard.ts**: `payByNfcUidPrepare`, `payByNfcUidSignContainer`, `ContainerRelayPreCheckUnsigned`, `ContainerRelayPayloadUnsigned`
- **x402sdk/beamioMaster.ts**: `/api/payByNfcUidPrepare`, `/api/payByNfcUidSignContainer`
- **x402sdk/beamioServer.ts**: Cluster 预检（含余额校验）并转发上述两个 API
- **x402sdk/beamioServer.ts getUIDAssets**: 返回 `aaAddress`
- **android-NDEF/MainActivity.kt**: `payByNfcUidWithContainer`, `payByNfcUidPrepare`, `payByNfcUidSignContainer`，`executePayment` 改为调用新流程
