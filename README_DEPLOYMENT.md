# BeamioAccount 部署和自动验证完整指南

## 🎯 功能概述

本项目已配置完整的部署和**自动合约验证**功能，支持：

1. ✅ **标准部署**: 直接部署 BeamioAccount 合约
2. ✅ **CREATE2 部署**: 通过 BeamioAccountDeployer 部署可预测地址的 AA 账号
3. ✅ **自动验证**: 部署后自动在 BaseScan 上验证合约源代码
4. ✅ **多网络支持**: Base 主网和 Base Sepolia 测试网

## 📋 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填入：

```bash
cp .env.example .env
```

**必需配置：**
- `PRIVATE_KEY`: 部署账户私钥（格式：`0x...`）
- `BASE_RPC_URL`: Base 主网 RPC（默认已配置）
- `BASESCAN_API_KEY`: BaseScan API Key（用于自动验证）[获取地址](https://basescan.org/myapikey)

**CREATE2 部署额外配置：**
- `DEPLOYER_ADDRESS`: BeamioAccountDeployer 合约地址
- `FACTORY_ADDRESS`: Factory 合约地址（可选）
- `CREATOR_ADDRESS`: 创建者地址（默认使用部署账户）
- `ACCOUNT_INDEX`: 账号索引（默认 0）

### 3. 编译合约

```bash
npm run compile
```

## 🚀 部署方式

### 方式 A: 标准部署

直接部署 BeamioAccount 合约：

```bash
# Base 主网
npm run deploy:base

# Base Sepolia 测试网
npm run deploy:base-sepolia
```

### 方式 B: CREATE2 部署（推荐用于批量部署）

**步骤 1: 部署 BeamioAccountDeployer**

```bash
# Base 主网
npm run deploy:deployer:base

# Base Sepolia 测试网
npm run deploy:deployer:base-sepolia
```

**步骤 2: 设置 Factory（如果需要）**

部署器部署后，需要设置 Factory 才能使用：

```typescript
await deployerContract.setFactory(factoryAddress);
```

**步骤 3: 通过部署器部署 AA 账号**

在 `.env` 中设置 `DEPLOYER_ADDRESS` 等变量后：

```bash
# Base 主网
npm run deploy:aa:base

# Base Sepolia 测试网
npm run deploy:aa:base-sepolia
```

## ✅ 自动合约验证

### 功能特性

- **自动验证**: 部署完成后自动验证，无需手动操作
- **智能等待**: 自动等待区块确认（30秒）后再验证
- **错误处理**: 友好的错误提示
- **重复检查**: 已验证的合约会自动跳过
- **CREATE2 支持**: 完全支持验证 CREATE2 部署的合约

### 验证流程

1. 部署合约
2. 等待区块确认（30秒）
3. 自动调用 BaseScan API 验证
4. 输出验证结果和查看链接

### 验证结果

验证成功后，可以在 BaseScan 上查看：
- ✅ 完整的合约源代码
- ✅ ABI 接口定义
- ✅ 合约交互功能
- ✅ 事件和函数文档

**查看链接格式**: `https://basescan.org/address/<合约地址>#code`

## 📁 部署信息保存

所有部署信息自动保存到 `deployments/` 目录：

- `{network}-BeamioAccount.json`: 标准部署信息
- `{network}-BeamioAccountDeployer.json`: 部署器信息
- `{network}-BeamioAccount-{index}.json`: CREATE2 部署的账号信息

每个文件包含：
- 合约地址
- 部署交易哈希
- 网络信息
- 部署时间戳
- 构造函数参数
- CREATE2 相关信息（如适用）

## 🔧 脚本说明

### 部署脚本

| 脚本 | 功能 | 网络参数 |
|------|------|----------|
| `deployBeamioAccount.ts` | 标准部署 BeamioAccount | `--network base` |
| `deployBeamioAccountDeployer.ts` | 部署 BeamioAccountDeployer | `--network base` |
| `deployAAAccountViaDeployer.ts` | 通过部署器部署 AA 账号 | `--network base` |

### 工具函数

| 文件 | 功能 |
|------|------|
| `scripts/utils/verifyContract.ts` | 通用合约验证工具 |

## 📝 使用示例

### 示例 1: 标准部署并自动验证

```bash
# 1. 配置 .env
PRIVATE_KEY=0x...
BASESCAN_API_KEY=your_api_key

# 2. 部署
npm run deploy:base

# 输出示例:
# ✅ BeamioAccount 部署成功!
# 合约地址: 0x1234...
# 开始验证合约...
# ✅ 合约验证成功!
# 查看合约: https://basescan.org/address/0x1234...#code
```

### 示例 2: CREATE2 部署多个账号

```bash
# 1. 部署部署器
npm run deploy:deployer:base
# 记录 DEPLOYER_ADDRESS

# 2. 设置 Factory
# (通过合约交互或脚本)

# 3. 部署多个账号
ACCOUNT_INDEX=0 npm run deploy:aa:base
ACCOUNT_INDEX=1 npm run deploy:aa:base
ACCOUNT_INDEX=2 npm run deploy:aa:base
```

## ⚠️ 重要提示

1. **私钥安全**
   - 永远不要提交 `.env` 到 Git
   - 使用专门的部署账户
   - 考虑使用硬件钱包或多签钱包

2. **Gas 费用**
   - 确保部署账户有足够的 ETH
   - Base 主网 Gas 费用较低
   - 建议先在测试网测试

3. **验证配置**
   - BaseScan API Key 是自动验证必需的
   - 验证可能需要几分钟时间
   - 如果验证失败，可以手动重试

4. **EntryPoint 地址**
   - EntryPoint V0.7 标准地址: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
   - 在所有链上相同

## 🐛 故障排除

### 编译错误

**"Stack too deep"**
- ✅ 已通过 `viaIR: true` 解决
- 如果仍有问题，检查 Solidity 版本

**"No contracts to compile"**
```bash
npm run clean && npm run compile
```

### 部署错误

**"insufficient funds"**
- 确保账户有足够的 ETH

**"nonce too low"**
- 等待几秒后重试

### 验证错误

**验证失败**
- 确保配置了 `BASESCAN_API_KEY`
- 等待更多区块确认（通常需要 5-10 个区块）
- 检查合约地址和构造函数参数

**"Already Verified"**
- 这是正常提示，表示合约已验证

## 📚 相关链接

- [Base 官方文档](https://docs.base.org/)
- [BaseScan 浏览器](https://basescan.org/)
- [BaseScan API Key](https://basescan.org/myapikey)
- [ERC-4337 规范](https://eips.ethereum.org/EIPS/eip-4337)
- [Hardhat 文档](https://hardhat.org/docs)

## 📄 许可证

MIT
