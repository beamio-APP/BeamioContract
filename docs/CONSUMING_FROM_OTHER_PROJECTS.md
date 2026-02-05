# 跨项目复用 BeamioContract 的合约知识

SilentPassUI（客户端）和 SDK（API 服务端）等项目需要与同一套合约交互时，可以按下面三种方式复用 **BeamioContract** 中的地址、ABI、类型和交互模式。

---

## 可复用的内容

| 内容 | 在 BeamioContract 中的位置 | 用途 |
|------|----------------------------|------|
| **Base 主网地址** | `config/base-addresses.ts`、`deployments/BASE_MAINNET_FACTORIES.md` | AA/Card Factory 等固定地址 |
| **合约 ABI** | `scripts/API server/ABI/*.json`、编译产物 `artifacts/` | 前端/服务端调用合约 |
| **TypeScript 类型** | `types/ethers-contracts/`（Hardhat 生成） | 类型安全的合约调用 |
| **交互模式** | `scripts/API server/MemberCard.ts`（如 DeployingSmartAccount、购卡流程） | 封装为 SDK 或共享工具函数 |

---

## 方式一：npm 包（推荐）

把 BeamioContract 发布成私有或公开 npm 包，SilentPassUI 和 SDK 以依赖形式引用。

### 1. 在 BeamioContract 中增加导出入口

在 `package.json` 中增加 `exports`（若尚未有）：

```json
{
  "name": "@beamio/contracts",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./config/base-addresses.ts",
    "./addresses": "./config/base-addresses.ts",
    "./types": "./types/ethers-contracts/index.ts"
  },
  "files": ["config", "types/ethers-contracts", "deployments", "artifacts"]
}
```

或先不发布，只在本地用 **npm link**：

```bash
# 在 BeamioContract 根目录
cd /path/to/BeamioContract
npm link

# 在 SilentPassUI 或 SDK 项目
cd /path/to/SilentPassUI   # 或 sdk
npm link beamiocontract    # 或 @beamio/contracts（与上面 name 一致）
```

### 2. 在 SilentPassUI（客户端）中使用

```ts
// 安装依赖
// npm install beamiocontract  或  npm link beamiocontract

import { BASE_MAINNET_CHAIN_ID, BASE_MAINNET_FACTORIES } from 'beamiocontract/config/base-addresses'
// 若通过 exports 暴露为包根
// import { BASE_MAINNET_FACTORIES } from '@beamio/contracts'

const aaFactoryAddress = BASE_MAINNET_FACTORIES.AA_FACTORY
const cardFactoryAddress = BASE_MAINNET_FACTORIES.CARD_FACTORY
// 连接钱包、创建 Contract 实例时使用上述地址 + 对应 ABI
```

### 3. 在 SDK（API 服务端）中使用

```ts
import { BASE_MAINNET_FACTORIES, CONTRACT_ADDRESSES } from 'beamiocontract/config/base-addresses'

// 与合约交互时统一用 CONTRACT_ADDRESSES.base 或 BASE_MAINNET_FACTORIES，避免多处写死地址
```

---

## 方式二：Git 子模块（同一仓库族、不发布 npm）

把 BeamioContract 作为子模块拉入 SilentPassUI 或 SDK，直接引用路径。

### 1. 在 SilentPassUI 或 SDK 中添加子模块

```bash
cd /path/to/SilentPassUI   # 或 sdk
git submodule add https://github.com/beamio-APP/BeamioContract.git libs/BeamioContract
```

### 2. 在代码中按相对路径引用

```ts
// SilentPassUI 或 SDK 中
import { BASE_MAINNET_FACTORIES } from './libs/BeamioContract/config/base-addresses.js'
// 或
import { BASE_MAINNET_FACTORIES } from '../BeamioContract/config/base-addresses.js'
```

ABI 和类型也可直接指向子模块路径，例如：

- `libs/BeamioContract/scripts/API server/ABI/BeamioUserCard.json`
- `libs/BeamioContract/types/ethers-contracts/`

---

## 方式三：Monorepo 共用一个 contracts 包

若希望三个项目在一个仓库里用 workspace 管理：

1. 新建 monorepo 根目录，使用 pnpm/npm/yarn workspaces。
2. 将 BeamioContract 作为其中一个 package（如 `packages/contracts`），或保留原 repo 结构，在根 `package.json` 的 `workspaces` 里包含 `BeamioContract`、`SilentPassUI`、`sdk`。
3. SilentPassUI 和 SDK 的 `package.json` 中增加依赖，例如：`"@beamio/contracts": "workspace:*"`。
4. 在 BeamioContract 的 `package.json` 里用 `exports` 暴露 `config/base-addresses.ts` 和（可选）`types/ethers-contracts`。

这样两个项目都通过包名引用，地址和类型只维护一份。

---

## 客户端（SilentPassUI）需要什么

- **链与地址**：`BASE_MAINNET_CHAIN_ID`、`BASE_MAINNET_FACTORIES`（或 `CONTRACT_ADDRESSES.base`）。
- **ABI**：与链上交互的合约 ABI（UserCard、Factory 等），可从 `BeamioContract/scripts/API server/ABI/` 或编译后的 `artifacts/` 复制/引用。
- **类型**：若用 TypeScript，可引用 `types/ethers-contracts` 中的类型或从 ABI 生成前端用类型。

建议：在 SilentPassUI 里封装一层「链配置 + 合约实例创建」，例如从 `@beamio/contracts`（或子模块）读地址，从同一来源读 ABI，这样合约升级时只改 BeamioContract 一处。

---

## API 服务端（SDK）需要什么

- **地址**：同上，用 `config/base-addresses.ts` 或 `BASE_MAINNET_FACTORIES.md`。
- **ABI**：与 MemberCard.ts 等逻辑一致，使用 `scripts/API server/ABI/` 下对应 JSON。
- **交互逻辑**：如「先确保 AA 再购卡」等，可把 `DeployingSmartAccount`、`purchasingCardProcess` 等封装成 SDK 的 API 或内部函数；SDK 通过子模块或 npm 包引用 BeamioContract 的地址与 ABI，业务逻辑可复制或再封装。

---

## 小结

| 方式 | 适用场景 |
|------|----------|
| **npm 包** | 希望版本清晰、CI 好装、多项目复用，可发布私有 npm 或仅本地 `npm link` |
| **Git 子模块** | 不发布 npm，但要保证 SilentPassUI/SDK 与合约库版本一一对应 |
| **Monorepo** | 三项目长期一起演进，希望统一构建和类型 |

无论哪种方式，**地址与链配置都只维护 BeamioContract 中的一份**（`config/base-addresses.ts` 与 `deployments/BASE_MAINNET_FACTORIES.md`），SilentPassUI 和 SDK 都从这份配置读取，避免多处写死地址导致不一致。
