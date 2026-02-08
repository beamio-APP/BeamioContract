/**
 * 为 BeamioOracle 设置 CAD（currency id = 0）汇率，用于 CCSA 卡等 CAD 计价卡的 quoteUnitPointInUSDC6。
 * 若未设置，payUSDCProcess / quoteUSDCForPoints 会报 "quote=0 (oracle not configured or card invalid)"。
 *
 * 用法：npm run set:oracle-cad:base
 * 或：npx hardhat run scripts/setOracleCadRate.ts --network base
 *
 * 要求：当前 signer 须为 Oracle 的 owner。
 */
import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CAD_CURRENCY_ID = 0;
const CAD_RATE_E18 = 1e18; // 1 CAD = 1 USD (E18)

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const fullFile = path.join(deploymentsDir, "base-FullAccountAndUserCard.json");
  let oracleAddress =
    process.env.ORACLE_ADDRESS ||
    (fs.existsSync(fullFile)
      ? (JSON.parse(fs.readFileSync(fullFile, "utf-8")) as { existing?: { beamioOracle?: string } }).existing
          ?.beamioOracle
      : "");

  if (!oracleAddress) {
    throw new Error("未找到 Oracle 地址，请设置 ORACLE_ADDRESS 或确保 deployments/base-FullAccountAndUserCard.json 存在且含 existing.beamioOracle");
  }

  const oracle = await ethers.getContractAt("BeamioOracle", oracleAddress);
  const current = await oracle.rates(CAD_CURRENCY_ID);

  if (current !== 0n) {
    console.log("CAD 汇率已设置:", current.toString(), "(无需重复设置)");
    return;
  }

  console.log("设置 Oracle CAD 汇率: currencyId=0, rateE18=" + CAD_RATE_E18);
  const tx = await oracle.updateRate(CAD_CURRENCY_ID, CAD_RATE_E18);
  await tx.wait();
  console.log("✅ 已设置，tx:", tx.hash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
