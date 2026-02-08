/**
 * 为 BeamioAccountDeployer 设置 factory 地址（仅当 factory 仍为 0 时）。
 * 部署 FullAccountAndUserCard 时若构造函数内 setFactory 因 code.length 未就绪而失败，需手动执行一次。
 *
 * 用法：npm run set:deployer-factory:base
 * 或：FACTORY_ADDRESS=0x... npx hardhat run scripts/setDeployerFactoryOnce.ts --network base
 */
import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const { ethers } = await networkModule.connect();
  const [signer] = await ethers.getSigners();
  const networkInfo = await ethers.provider.getNetwork();
  const deploymentsDir = path.join(__dirname, "..", "deployments");

  let factoryAddress = process.env.FACTORY_ADDRESS || "";
  let deployerAddress = process.env.DEPLOYER_ADDRESS || "";

  if (!factoryAddress || !deployerAddress) {
    const fullFile = path.join(deploymentsDir, `${networkInfo.name}-FullAccountAndUserCard.json`);
    if (!fs.existsSync(fullFile)) {
      console.error("未找到 FullAccountAndUserCard 部署文件，请设置 FACTORY_ADDRESS 和 DEPLOYER_ADDRESS");
      process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(fullFile, "utf-8"));
    if (!factoryAddress) factoryAddress = data.contracts?.beamioFactoryPaymaster?.address;
    if (!deployerAddress) deployerAddress = data.contracts?.beamioAccountDeployer?.address;
  }

  if (!factoryAddress || !deployerAddress) {
    console.error("缺少 Factory 或 Deployer 地址");
    process.exit(1);
  }

  const deployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  const current = await deployer.factory();
  if (current !== ethers.ZeroAddress) {
    console.log("Deployer.factory 已设置:", current);
    if (current.toLowerCase() === factoryAddress.toLowerCase()) {
      console.log("与目标 Factory 一致，无需操作");
      return;
    }
    console.error("当前 factory 与目标不同，且 setFactory 仅能调用一次，无法更改");
    process.exit(1);
  }

  console.log("设置 Deployer.factory 为", factoryAddress);
  const tx = await deployer.setFactory(factoryAddress);
  await tx.wait();
  console.log("✅ 已设置，tx:", tx.hash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
