/**
 * Base Mainnet 合约地址与链配置（供 SilentPassUI、SDK 等跨项目引用）
 * 与 deployments/BASE_MAINNET_FACTORIES.md 保持一致，请勿在 APP 中写死其他来源的地址。
 */
export const BASE_MAINNET_CHAIN_ID = 8453

export const BASE_MAINNET_FACTORIES = {
  /** AA 账户工厂 (BeamioFactoryPaymasterV07) */
  AA_FACTORY: '0xD4759c85684e47A02223152b85C25D2E5cD2E738',
  /** UserCard 工厂 (BeamioUserCardFactoryPaymasterV07) */
  CARD_FACTORY: '0x73e3b722Eb55C92Fe73DEC01c064a5C677079E03',
} as const

/** 按链聚合，便于多链扩展 */
export const CONTRACT_ADDRESSES = {
  base: {
    chainId: BASE_MAINNET_CHAIN_ID,
    aaFactory: BASE_MAINNET_FACTORIES.AA_FACTORY,
    cardFactory: BASE_MAINNET_FACTORIES.CARD_FACTORY,
  },
} as const

export type ChainKey = keyof typeof CONTRACT_ADDRESSES
