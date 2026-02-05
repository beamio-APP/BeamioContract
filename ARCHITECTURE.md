# BeamioContract 架构说明

## 📐 系统架构概览

BeamioContract 包含两个主要系统：

1. **BeamioAccount 系统** - ERC-4337 Account Abstraction
2. **BeamioUserCard 系统** - ERC-1155 用户卡系统

## 🔗 依赖关系

### BeamioAccount 系统

```
BeamioAccount
  ├── EntryPoint V0.7 (构造函数参数)
  ├── Factory (通过 initialize 设置)
  └── ContainerModule (通过 initialize 设置)
```

**重要**: BeamioAccount **不直接依赖** BeamioOracle。

### BeamioUserCard 系统

```
BeamioUserCard
  └── Gateway (BeamioUserCardFactoryPaymasterV07)
      ├── BeamioQuoteHelperV07
      │   └── BeamioOracle ⭐ (需要汇率)
      ├── RedeemModule
      └── AA Factory (用于创建账户)
```

## ❓ 为什么 BeamioAccount 部署不需要 Oracle？

### 原因分析

1. **BeamioAccount 的构造函数**只需要 `EntryPoint` 地址：
   ```solidity
   constructor(IEntryPointV07 ep) {
       entryPoint = ep;
   }
   ```

2. **BeamioAccount 的 initialize 函数**需要：
   - `owner`: 账户所有者
   - `managersSorted`: 管理者列表
   - `threshold`: 多签阈值
   - `factory`: Factory 地址（用于权限控制）
   - `module`: Container Module 地址（用于资产操作）

3. **Oracle 是 UserCard 系统需要的**，不是 Account 系统需要的：
   - BeamioAccount 本身不处理汇率转换
   - 汇率转换由 BeamioUserCard 通过 Gateway 访问 Oracle
   - Account 和 UserCard 是两个独立的系统

### 架构分离

```
┌─────────────────┐         ┌──────────────────┐
│  BeamioAccount  │         │  BeamioUserCard  │
│  (AA 账户)      │         │  (用户卡系统)     │
│                 │         │                  │
│  - EntryPoint   │         │  - Gateway       │
│  - Factory      │         │    └─ Oracle ⭐   │
│  - Module       │         │                  │
└─────────────────┘         └──────────────────┘
     独立系统                     需要 Oracle
```

## 🚀 完整系统部署

如果需要使用完整的 Beamio 生态系统（包括 UserCard），需要部署以下合约：

### 部署顺序

1. **BeamioOracle** - 汇率预言机
2. **BeamioQuoteHelperV07** - 报价辅助（依赖 Oracle）
3. **BeamioAccountDeployer** - CREATE2 部署器
4. **BeamioAccount** - AA 账号（可选，通常通过 Deployer 部署）
5. **BeamioUserCardFactoryPaymasterV07** - Factory/Paymaster/Gateway（依赖 QuoteHelper）
6. **BeamioUserCard** - 用户卡（通过 Factory 部署）

### 使用完整部署脚本

```bash
# 部署完整系统（包括 Oracle）
npm run deploy:full:base
```

这个脚本会：
- ✅ 部署 BeamioOracle
- ✅ 部署 BeamioQuoteHelperV07（使用 Oracle 地址）
- ✅ 部署 BeamioAccountDeployer
- ✅ 部署 BeamioAccount（可选）
- ✅ 自动验证所有合约

## 📝 部署后配置

### 1. 初始化 BeamioAccount

```typescript
await beamioAccount.initialize(
  owner,           // 账户所有者
  managersSorted,  // 管理者列表（排序）
  threshold,       // 多签阈值
  factory,         // Factory 地址
  module           // Container Module 地址
);
```

### 2. 设置 AccountDeployer Factory

```typescript
await accountDeployer.setFactory(factoryAddress);
```

### 3. 配置 Oracle 汇率

```typescript
// 更新单个汇率
await oracle.updateRate(currencyId, rateE18);

// 批量更新汇率
await oracle.updateRatesBatch(currencyIds, rates);
```

### 4. 设置 UserCard Gateway

```typescript
await userCard.setGateway(gatewayAddress);
```

## 🔍 合约交互流程

### UserCard 使用 Oracle 的流程

```
用户操作
  ↓
BeamioUserCard
  ↓
factoryGateway() → BeamioUserCardFactoryPaymasterV07
  ↓
quoteCurrencyAmountInUSDC6() → BeamioQuoteHelperV07
  ↓
getRate() → BeamioOracle ⭐
  ↓
返回汇率
```

### Account 操作流程

```
用户操作
  ↓
EntryPoint
  ↓
BeamioAccount.validateUserOp()
  ↓
检查签名和权限
  ↓
执行操作（通过 Module）
```

## ⚠️ 重要提示

1. **BeamioAccount 和 BeamioUserCard 是独立系统**
   - Account 不需要 Oracle
   - UserCard 需要 Oracle（通过 Gateway）

2. **如果只使用 Account 功能**
   - 只需要部署 BeamioAccount
   - 不需要部署 Oracle

3. **如果使用 UserCard 功能**
   - 必须部署 Oracle
   - 必须部署 QuoteHelper
   - 必须部署 FactoryPaymaster（作为 Gateway）

4. **部署脚本说明**
   - `deployBeamioAccount.ts`: 只部署 Account（不需要 Oracle）
   - `deployFullSystem.ts`: 部署完整系统（包括 Oracle）

## 📚 相关文档

- [部署指南](./DEPLOY.md)
- [完整部署说明](./README_DEPLOYMENT.md)
- [README](./README.md)
