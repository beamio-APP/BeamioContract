# Fuel Center originalPaymentHash 检查报告

## 1. Indexer 原始数据检查

从 CoNET Indexer 拉取 `0x513087820Af94A7f4d21bC5B68090f3080022E0e` 的账本：

```bash
CHECK_ACCOUNT=0x513087820Af94A7f4d21bC5B68090f3080022E0e npx hardhat run scripts/checkBUnitLedgerRaw.ts --network conet
```

**结论**：BeamioIndexerDiamond 的原始记录**包含** `originalPaymentHash`。

示例（requestAccounting 类型）：
- `originalPaymentHash`: `0x43daa8f1ada9a3f6af063c92923d43c70442b6b2e3f4ecbef90ef0869c23527b`
- `originalPaymentHash` 类型: `string`
- `ethers.isHexString(rawOph)`: true
- `ethers.dataLength(rawOph)`: 32

## 2. 转换逻辑模拟

运行 `simulateGetBUnitLedger.ts` 模拟 beamioServer 的转换逻辑：

```bash
CHECK_ACCOUNT=0x513087820Af94A7f4d21bC5B68090f3080022E0e npx hardhat run scripts/simulateGetBUnitLedger.ts --network conet
```

**结论**：转换逻辑正确，输出**包含** `originalPaymentHash`。

示例 JSON（第一条 Service Fee 记录）：
```json
{
  "id": "0x466d5c25bab925033e6636d4ce20388ff69161cc2c2398f665737ed578862faf",
  "title": "Service Fee (0.8%)",
  "subtitle": "Payment Request 7cf",
  "originalPaymentHash": "0xd67ee78fb03ef90160f59baef46626bf5571b3802a1164f271e7cb95aa7307cf",
  ...
}
```

## 3. 为何 View Smart Receipt 未显示 originalPaymentHash

可能原因：

### 3.1 API 缓存（最可能）

`beamioServer` 的 `getBUnitLedger` 有 **30 秒** 内存缓存：

```typescript
// beamioServer.ts
const getBUnitLedgerCache = new Map<string, { body: string; statusCode: number; expiry: number }>()
// ...
if (cached && Date.now() < cached.expiry) {
  return res.status(cached.statusCode).setHeader('Content-Type', 'application/json').send(cached.body)
}
```

若缓存在**旧代码部署前**生成，则返回的 JSON 不含 `originalPaymentHash`，直至缓存过期（30 秒）。

### 3.2 服务未更新

`x402sdk`（beamioServer）需重新部署并重启。若生产环境仍使用旧版本，则不会包含 `originalPaymentHash`。

### 3.3 客户端未重建

`SilentPassUI` 的 `BeamioCard.ts` 有 RPC 回退逻辑。若 API 失败，会直接调用 Indexer。若客户端未重建，RPC 回退可能仍使用旧逻辑。

## 4. 建议

1. **确认部署**：`x402sdk` 已 push 后，需重新部署 beamioServer 并重启服务。
2. **清除缓存**：重启后等待 30 秒，或添加缓存绕过参数（见下）。
3. **重建客户端**：若使用 RPC 回退，需重新构建 SilentPassUI。

## 5. 验证脚本

- `scripts/checkBUnitLedgerRaw.ts` - 检查 Indexer 原始数据
- `scripts/simulateGetBUnitLedger.ts` - 模拟 API 转换输出
