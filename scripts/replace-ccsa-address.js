#!/usr/bin/env node
/**
 * 将代码库中旧的 CCSA 卡地址替换为新地址。
 * 用法：
 *   NEW_CCSA_ADDRESS=0x... node scripts/replace-ccsa-address.js
 *   或
 *   node scripts/replace-ccsa-address.js 0x新地址
 *
 * 新地址需先通过 createCCSA 发行：
 *   cd src/x402sdk && npx ts-node src/createCCSA.ts
 *
 * 更新的文件（单一数据源）：x402sdk/chainAddresses、SilentPassUI/config、deployments JSON。
 * MemberCard（x402sdk 与 scripts/API server）与 SilentPassUI/contracts 均从上述配置读取，无需再替换。
 */
const fs = require('fs')
const path = require('path')

const OLD = '0xd81B78B3E3253b37B44b75E88b6965FE887721a3'
const ROOT = path.resolve(__dirname, '..')

const FILES = [
  'src/x402sdk/src/chainAddresses.ts',
  'src/SilentPassUI/src/config/chainAddresses.ts',
  'deployments/base-UserCard-0xEaBF0A98.json',
]

function main() {
  const newAddr = process.env.NEW_CCSA_ADDRESS || process.argv[2]
  if (!newAddr || !/^0x[a-fA-F0-9]{40}$/.test(newAddr)) {
    console.error('Usage: NEW_CCSA_ADDRESS=0x... node scripts/replace-ccsa-address.js')
    console.error('   or: node scripts/replace-ccsa-address.js 0x<new-address>')
    process.exit(1)
  }

  let replaced = 0
  for (const rel of FILES) {
    const file = path.join(ROOT, rel)
    if (!fs.existsSync(file)) {
      console.warn('Skip (not found):', rel)
      continue
    }
    let content = fs.readFileSync(file, 'utf8')
    const count = (content.match(new RegExp(OLD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
    if (count === 0) {
      console.log('No match:', rel)
      continue
    }
    content = content.split(OLD).join(newAddr)
    fs.writeFileSync(file, content)
    console.log('Updated', count, 'occurrence(s):', rel)
    replaced += count
  }
  console.log('Done. Replaced', replaced, 'occurrence(s) with', newAddr)
}

main()
