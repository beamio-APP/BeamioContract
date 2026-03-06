/**
 * Base Mainnet 合约地址与链配置（供 SilentPassUI、SDK 等跨项目引用）
 * 与 deployments/BASE_MAINNET_FACTORIES.md 保持一致，请勿在 APP 中写死其他来源的地址。
 */
export const BASE_MAINNET_CHAIN_ID = 8453

export const BASE_MAINNET_FACTORIES = {
  /** AA 账户工厂 (BeamioFactoryPaymasterV07) */
  AA_FACTORY: '0xD86403DD1755F7add19540489Ea10cdE876Cc1CE',
  /** UserCard 工厂 (BeamioUserCardFactoryPaymasterV07) */
  CARD_FACTORY: '0x331a8ebc41afbAf01D78Fd2684D609407527DA18',
} as const

/** BaseTreasury: USDC 购买 B-Unit 入口，用户 EIP-3009 离线签字后由服务端提交 */
export const BASE_TREASURY = '0x5c64a8b0935DA72d60933bBD8cD10579E1C40c58'

/** 按链聚合，便于多链扩展 */
export const CONTRACT_ADDRESSES = {
  base: {
    chainId: BASE_MAINNET_CHAIN_ID,
    aaFactory: BASE_MAINNET_FACTORIES.AA_FACTORY,
    cardFactory: BASE_MAINNET_FACTORIES.CARD_FACTORY,
  },
} as const

export type ChainKey = keyof typeof CONTRACT_ADDRESSES
