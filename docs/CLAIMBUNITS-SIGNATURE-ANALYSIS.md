# B-Unit Claim 签名错误分析

## 问题描述

Conet 链交易 `0xce2f0bb8e103a509be11bd81ddf8df133a7a9256f1036362623823e294675401` 失败，`claimFor` revert 原因为 **InvalidSignature**：

- **Recovered signer**（签名者）: `0x83Df37f5dc638E74472e2E6A266817be17EaF908`
- **Claimant**（请求申领地址）: `0xd5B0046D166266C51143e1221811672958c89Ea3`

合约要求 `signer == claimant`，即签名必须由 claimant 本人私钥签署。

## UI 申领流程分析

### 正常流程（App.tsx / bizSite App.tsx）

```ts
// 1. claimant 从私钥推导（正确做法）
claimant = new ethers.Wallet(p0.privateKeyArmor).address

// 2. 使用同一私钥签名
signAndClaimBUnits(p0.privateKeyArmor!, claimant, r.nonce, r.deadline)
```

`signAndClaimBUnits` 内部已有校验：`wallet.address !== claimant` 时返回错误，不会发送请求。

### 可能导致 signer != claimant 的场景

1. **Profile 数据不一致**：`profiles[0].keyID` ≠ `new ethers.Wallet(profiles[0].privateKeyArmor).address`
   - 若某处错误使用 `keyID` 作为 claimant，而用 `privateKeyArmor` 签名，会得到不同地址
   - 当前 App.tsx 使用 `wallet.address` 作为 claimant，未使用 keyID

2. **外部客户端**：非 SilentPassUI/bizSite 的脚本、第三方应用或手动 API 调用，可能传错 claimant

3. **多设备/多 Profile 同步异常**：profile 数据在设备间同步时 keyID 与私钥错配

## 已实施的修复

### 1. Cluster 签名预检（MemberCard.ts）

在 `claimBUnitsPreCheck` 中增加 EIP-712 验签：`ethers.verifyTypedData` 恢复 signer，若 `signer !== claimant` 则拒绝并返回 400，不转发 Master。

### 2. Profile 一致性防御（App.tsx / bizSite App.tsx）

申领前检查：若 `keyID` 存在且与私钥推导地址不一致，则跳过自动申领，避免 profile 数据异常导致链上失败。

```ts
if (p0.keyID && ethers.isAddress(p0.keyID) && p0.keyID.toLowerCase() !== claimant.toLowerCase()) {
  return  // 跳过，不发起 claim
}
```

## 建议

- **claimant 始终从私钥推导**：`claimant = new ethers.Wallet(privateKey).address`，不要使用 keyID 或 myAddress
- **Profile 完整性**：确保 keyID 与 privateKeyArmor 一一对应，导入/迁移时校验一致性
