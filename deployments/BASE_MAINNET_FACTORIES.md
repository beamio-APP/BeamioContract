# Base Mainnet 基础设施地址（固定值）

**正式部署后，以下两个 Factory 作为基础设施，请勿重新部署。**  
所有 APP 应使用下列地址作为固定配置。

---

## 1. AA Factory（账户工厂）

创建 BeamioAccount（智能合约账户）的工厂合约。

| 项目 | 值 |
|------|-----|
| **合约** | BeamioFactoryPaymasterV07 |
| **地址** | `0xFD48F7a6bBEb0c0C1ff756C38cA7fE7544239767` |
| **网络** | Base Mainnet (Chain ID: 8453) |

---

## 2. Card Factory（UserCard 工厂）

创建 BeamioUserCard（用户卡）的工厂合约。

| 项目 | 值 |
|------|-----|
| **合约** | BeamioUserCardFactoryPaymasterV07 |
| **地址** | `0x7Ec828BAbA1c58C5021a6E7D29ccDDdB2d8D84bd` |
| **网络** | Base Mainnet (Chain ID: 8453) |

---

## APP 配置示例

```ts
// 固定常量，部署到所有 APP
export const BASE_MAINNET_CHAIN_ID = 8453;

export const BASE_MAINNET_FACTORIES = {
  /** AA 账户工厂 (BeamioFactoryPaymasterV07) */
  AA_FACTORY: '0xFD48F7a6bBEb0c0C1ff756C38cA7fE7544239767',
  /** UserCard 工厂 (BeamioUserCardFactoryPaymasterV07) */
  CARD_FACTORY: '0x7Ec828BAbA1c58C5021a6E7D29ccDDdB2d8D84bd',
} as const;
```

```json
{
  "base": {
    "chainId": 8453,
    "aaFactory": "0xFD48F7a6bBEb0c0C1ff756C38cA7fE7544239767",
    "cardFactory": "0x7Ec828BAbA1c58C5021a6E7D29ccDDdB2d8D84bd"
  }
}
```

---

## 区块浏览器

- AA Factory: https://basescan.org/address/0xFD48F7a6bBEb0c0C1ff756C38cA7fE7544239767  
- Card Factory: https://basescan.org/address/0x7Ec828BAbA1c58C5021a6E7D29ccDDdB2d8D84bd  

---

*文档生成自当前部署记录，请勿再重新部署上述两个 Factory。*
