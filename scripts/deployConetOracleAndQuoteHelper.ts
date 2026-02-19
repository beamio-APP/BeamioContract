import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const { ethers } = await networkModule.connect();
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("Deploy BeamioOracle + BeamioQuoteHelperV07 on conet");
  console.log("=".repeat(60));
  console.log("deployer:", deployer.address);
  console.log("chainId:", net.chainId.toString());

  const OracleFactory = await ethers.getContractFactory("BeamioOracle");
  const oracle = await OracleFactory.deploy();
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("BeamioOracle:", oracleAddress);

  const QuoteHelperFactory = await ethers.getContractFactory("BeamioQuoteHelperV07");
  const quoteHelper = await QuoteHelperFactory.deploy(oracleAddress, deployer.address);
  await quoteHelper.waitForDeployment();
  const quoteHelperAddress = await quoteHelper.getAddress();
  console.log("BeamioQuoteHelperV07:", quoteHelperAddress);

  const out = {
    network: "conet",
    chainId: net.chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      beamioOracle: {
        address: oracleAddress,
        transactionHash: oracle.deploymentTransaction()?.hash ?? "",
      },
      beamioQuoteHelperV07: {
        address: quoteHelperAddress,
        oracle: oracleAddress,
        transactionHash: quoteHelper.deploymentTransaction()?.hash ?? "",
      },
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  const outPath = path.join(deploymentsDir, "conet-OracleQuoteHelper.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log("saved:", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

