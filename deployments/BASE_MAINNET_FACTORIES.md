# Base Mainnet 基础设施地址

**单一数据源：** `config/base-addresses.ts`。AA Factory 重部署后会更新该文件，UI/API/SDK 均从此处或同步文件读取。

---

## 1. AA Factory（账户工厂）

创建 BeamioAccount（智能合约账户）的工厂合约。  
重部署后地址会变，以 `config/base-addresses.ts` 中的 `AA_FACTORY` 为准。

| 项目 | 值 |
|------|-----|
| **合约** | BeamioFactoryPaymasterV07 |
| **地址** | 见 `config/base-addresses.ts`（当前为 `0xD4759c85684e47A02223152b85C25D2E5cD2E738`） |
| **网络** | Base Mainnet (Chain ID: 8453) |

**重部署 AA Factory：** `npm run redeploy:aa-factory:base`。完成后需由 Card Factory owner 执行 `npm run set:card-factory-aa:base`（或链上调用 `setAAFactory(新地址)`）。

---

## 2. Card Factory（UserCard 工厂）

创建 BeamioUserCard（用户卡）的工厂合约。

| 项目 | 值 |
|------|-----|
| **合约** | BeamioUserCardFactoryPaymasterV07 |
| **地址** | 见 `config/base-addresses.ts`（当前为 `0x73e3b722Eb55C92Fe73DEC01c064a5C677079E03`） |
| **网络** | Base Mainnet (Chain ID: 8453) |

---

## APP 配置示例

```ts
// 固定常量，部署到所有 APP
export const BASE_MAINNET_CHAIN_ID = 8453;

export const BASE_MAINNET_FACTORIES = {
  /** AA 账户工厂 (BeamioFactoryPaymasterV07) */
  AA_FACTORY: '0xD4759c85684e47A02223152b85C25D2E5cD2E738',
  /** UserCard 工厂 (BeamioUserCardFactoryPaymasterV07) */
  CARD_FACTORY: '0x73e3b722Eb55C92Fe73DEC01c064a5C677079E03',
} as const;
```

```json
{
  "base": {
    "chainId": 8453,
    "aaFactory": "0xD4759c85684e47A02223152b85C25D2E5cD2E738",
    "cardFactory": "0x73e3b722Eb55C92Fe73DEC01c064a5C677079E03"
  }
}
```

---

## 区块浏览器

- AA Factory: https://basescan.org/address/0xD4759c85684e47A02223152b85C25D2E5cD2E738  
- Card Factory: https://basescan.org/address/0x73e3b722Eb55C92Fe73DEC01c064a5C677079E03  

---

*Card Factory 请勿随意重部署；AA Factory 可按需重部署并更新 config 与 Card Factory 的 aaFactory。*
