# API Server (MemberCard)

此目录为 MemberCard 相关 API 服务脚本，依赖根目录安装的 npm 包。已整合 [Settle x402 SDK](https://github.com/settleonbase/x402sdk)，便于在 Base 上做免 Gas USDC 支付与 x402 流程。

## 依赖

在仓库根目录执行：

```bash
npm install
```

已为 `MemberCard.ts` 与 x402 流程添加的依赖包括：

- **express** — HTTP 服务
- **colors** — 终端彩色输出（`colors/safe`）
- **ethers** — 与链交互（与 Hardhat 共用）
- **@settle402/sdk** — [Settle on Base x402 SDK](https://github.com/settleonbase/x402sdk)：Base 链上免 Gas USDC 转账、x402 facilitator、签名与结算 API
- **@types/express**、**@types/node** — TypeScript 类型

## 本地模块与 ABI

- **util.ts** — `masterSetup`、`checkSign` 占位实现，请按需替换为真实配置与验签逻辑。
- **logger.ts** — 简单控制台日志，可替换为 pino/winston 等。
- **ABI/** — 当前为占位空 JSON（`[]` 或 `{ "abi": [], "bytecode": "0x" }`），仅用于通过类型检查与模块解析。  
  若需真实合约调用，请用本仓库 `npm run compile` 生成的 `artifacts/**/*.json` 中的 ABI 覆盖对应文件，或修改 `MemberCard.ts` 的 import 路径指向 artifacts。

## x402 SDK 整合（Settle on Base）

- **依赖来源**：根目录 `package.json` 中已添加 `"@settle402/sdk": "github:settleonbase/x402sdk#main"`，在仓库根执行 `npm install` 即可拉取并安装。若从 Git 安装失败（如权限或网络），可暂时改为 npm 版本（若已发布）：`"@settle402/sdk": "^1.0.1"`，或先移除该依赖，仅保留 `@coinbase/x402` 与现有 util 流程。
- **使用方式**：安装后可在 API server 中 `import ... from '@settle402/sdk'` 使用；SDK 提供 x402 网关/服务与高层 API，详见本目录 **x402-sdk.md**。
- **协议关系**：当前 `util.ts` 已使用 `@coinbase/x402` 与 x402 的 `verify`/`settle`；Settle SDK 在此基础上封装了免 Gas USDC、简化签名与结算 API，可与现有 `verifyPayment`、`checkx402paymentHeader`、`settleResponseHeader` 等流程配合或逐步替换为 SDK 提供的高层接口以加速开发。

## 运行

需在配置好 `.env`（如 `BASE_RPC_URL`、`SETTLE_CONTRACT_ADMIN_PKS` 等）后，由上层应用或脚本引用并启动（本目录未包含独立入口脚本）。
