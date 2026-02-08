/**
 * BeamioQuoteHelperV07 与 BeamioOracle 禁止重新部署。
 * 本脚本已禁用；请使用已有地址（见 deployments/base-FullAccountAndUserCard.json existing.beamioQuoteHelper / beamioOracle）。
 */
async function main() {
  throw new Error(
    "BeamioQuoteHelperV07 与 BeamioOracle 禁止重新部署。请使用已有地址：\n" +
    "  - 从 deployments/base-FullAccountAndUserCard.json 的 existing.beamioOracle / existing.beamioQuoteHelper 读取；\n" +
    "  - 或设置 EXISTING_ORACLE_ADDRESS / EXISTING_QUOTE_HELPER_ADDRESS 环境变量。"
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
