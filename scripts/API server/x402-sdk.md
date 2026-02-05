# x402 SDK 整合说明（Settle on Base）

本 API server 已把 [Settle x402 SDK](https://github.com/settleonbase/x402sdk) 作为依赖加入项目，便于在 Base 上做免 Gas USDC 支付并与现有 x402 流程整合。

## 安装

在仓库根目录执行：

```bash
npm install
```

当前 `package.json` 中为：

- `"@settle402/sdk": "github:settleonbase/x402sdk#main"`

若希望使用 npm 已发布版本（若存在），可改为：

- `"@settle402/sdk": "^1.0.1"`

## 与本 API server 的关系

- **util.ts** 已使用 **@coinbase/x402** 与 x402 协议（`useFacilitator`、`verify`、`settle`、`settleResponseHeader`、`checkx402paymentHeader` 等）。
- **Settle x402 SDK** 在相同协议上封装了：
  - 免 Gas USDC 转账
  - x402 facilitator 集成
  - 简化签名与结算 API

可在以下方向加速开发：

1. **逐步替换**：在 `util.ts` 或 `MemberCard.ts` 中，将部分自研 x402 流程改为调用 `@settle402/sdk` 提供的高层 API。
2. **并行使用**：保留现有 `verifyPayment` / `settle` 流程，新接口（如新支付、新结算）直接使用 SDK。
3. **同进程或独立进程**：x402sdk 仓库提供 `x402Server` 与 `launchDaemon`，可在一台机器上与本 API 同进程引用，或单独起一个 x402 网关服务，由本 API 通过 HTTP 调用。

## 在代码中引用

```ts
// 按 x402sdk 仓库导出方式使用，例如：
// import { launchDaemon, x402Server } from '@settle402/sdk'
// 或查阅 node_modules/@settle402/sdk 的 package.json "main"/"exports" 确定入口
```

安装完成后可查看：

```bash
ls node_modules/@settle402/sdk
cat node_modules/@settle402/sdk/package.json
```

根据其 `main` / `dist/index.js` 导出内容在 `util.ts` 或新模块中 `import` 使用。

## 参考

- 仓库：https://github.com/settleonbase/x402sdk  
- npm（若已发布）：`npm i @settle402/sdk`  
- x402 协议与 CDP：当前 util 已用 `@coinbase/x402`，与 Settle SDK 同属 x402 生态，可混用。
