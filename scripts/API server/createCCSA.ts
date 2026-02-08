/**
 * 使用 createBeamioCardWithFactory 发行一张新的 CCSA 卡。
 * 与 MemberCard 相同原理：从 ~/.master.json 读取 masterSetup（与 util 同源），组装 Settle_ContractPool[0].baseFactoryPaymaster，无需外部导入私钥。
 *
 * 运行：cd "scripts/API server" && npx ts-node createCCSA.ts
 */

import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ethers } from 'ethers'

const require = createRequire(import.meta.url)
// 使用 x402sdk 的 ABI（含 createCardCollectionWithInitCode），与 MemberCard 调用的工厂一致
const BeamioFactoryPaymasterABI = require('../../src/x402sdk/src/ABI/BeamioUserCardFactoryPaymaster.json')

const { BASE_CARD_FACTORY } = require('../../src/x402sdk/src/chainAddresses')
const BeamioUserCardFactoryPaymasterV2 = BASE_CARD_FACTORY
const CARD_ISSUER_ADDRESS = '0xEaBF0A98aC208647247eAA25fDD4eB0e67793d61'
const ONE_CAD_E6 = 1_000_000

function loadMasterSetup(): { base_endpoint: string; settle_contractAdmin: string[] } {
  const setupFile = join(homedir(), '.master.json')
  if (!existsSync(setupFile)) throw new Error('未找到 ~/.master.json，请先配置')
  const raw = readFileSync(setupFile, 'utf-8')
  const data = JSON.parse(raw)
  if (!data?.base_endpoint || !Array.isArray(data?.settle_contractAdmin)) {
    throw new Error('~/.master.json 需包含 base_endpoint 和 settle_contractAdmin')
  }
  return data
}

function buildSettleContractPool(masterSetup: { base_endpoint: string; settle_contractAdmin: string[] }) {
  const providerBase = new ethers.JsonRpcProvider(masterSetup.base_endpoint)
  const pool: { baseFactoryPaymaster: ethers.Contract; walletBase: ethers.Wallet }[] = []
  for (const pk of masterSetup.settle_contractAdmin) {
    const walletBase = new ethers.Wallet(pk, providerBase)
    const baseFactoryPaymaster = new ethers.Contract(
      BeamioUserCardFactoryPaymasterV2,
      BeamioFactoryPaymasterABI,
      walletBase
    )
    pool.push({ baseFactoryPaymaster, walletBase })
  }
  return pool
}

async function main() {
  const { createBeamioCardWithFactory } = await import('../../src/x402sdk/src/CCSA.ts')
  const masterSetup = loadMasterSetup()
  if (!masterSetup.settle_contractAdmin.length) {
    throw new Error('masterSetup.settle_contractAdmin 为空，请配置 ~/.master.json')
  }
  const Settle_ContractPool = buildSettleContractPool(masterSetup)
  // 使用地址为 CARD_ISSUER_ADDRESS (0xEaBF...) 的钱包作为 factory signer（工厂要求该地址为 paymaster/调用者）
  const SC = Settle_ContractPool.find((e) => e.walletBase.address.toLowerCase() === CARD_ISSUER_ADDRESS.toLowerCase()) ?? Settle_ContractPool[0]
  if (!SC) throw new Error('Settle_ContractPool 为空，请配置 ~/.master.json settle_contractAdmin')
  if (SC.walletBase.address.toLowerCase() !== CARD_ISSUER_ADDRESS.toLowerCase()) {
    console.warn('警告: 未找到地址为 0xEaBF0A98... 的私钥，使用第一项。若链上 revert，请在 settle_contractAdmin 中配置该地址对应私钥。')
  }

  const factory = SC.baseFactoryPaymaster
  const cardOwner = process.env.CARD_OWNER
    ? ethers.getAddress(process.env.CARD_OWNER)
    : ethers.getAddress(CARD_ISSUER_ADDRESS)

  console.log('Creating CCSA card...')
  console.log('  Factory (Settle_ContractPool[0].baseFactoryPaymaster):', await factory.getAddress())
  console.log('  Provider (masterSetup.base_endpoint):', masterSetup.base_endpoint)
  console.log('  Signer (walletBase):', SC.walletBase.address)
  console.log('  Card issuer (owner):', cardOwner)
  console.log('  Currency: CAD, Unit price: 1 token = 1 CAD (pointsUnitPriceInCurrencyE6 = 1e6)')

  const cardAddress = await createBeamioCardWithFactory(
    factory,
    cardOwner,
    'CAD',
    ONE_CAD_E6,
    {}
  )

  console.log('CCSA card created:', cardAddress)
  console.log('From repo root, update address: NEW_CCSA_ADDRESS=' + cardAddress + ' node scripts/replace-ccsa-address.js')
}

main().catch((e: Error) => {
  console.error(e)
  process.exit(1)
})
