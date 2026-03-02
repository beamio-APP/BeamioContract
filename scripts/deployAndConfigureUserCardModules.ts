import { network as networkModule } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ModuleAddresses = {
  redeemModule: string;
  issuedNftModule: string;
  faucetModule: string;
  governanceModule: string;
};

function loadSignerPk(): string {
  if (process.env.PRIVATE_KEY && process.env.PRIVATE_KEY.trim()) {
    return process.env.PRIVATE_KEY.startsWith("0x")
      ? process.env.PRIVATE_KEY
      : `0x${process.env.PRIVATE_KEY}`;
  }

  const setupPath = path.join(homedir(), ".master.json");
  if (!fs.existsSync(setupPath)) {
    throw new Error("未找到 PRIVATE_KEY，且 ~/.master.json 不存在");
  }
  const data = JSON.parse(fs.readFileSync(setupPath, "utf-8"));
  const pk = data?.settle_contractAdmin?.[0];
  if (!pk || typeof pk !== "string") {
    throw new Error("未找到 PRIVATE_KEY，且 ~/.master.json 缺少 settle_contractAdmin[0]");
  }
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

function ensureCode(code: string, name: string, address: string) {
  if (code === "0x" || code === "0x0") {
    throw new Error(`${name} 无合约代码: ${address}`);
  }
}

function selector(signature: string): string {
  return ethers.id(signature).slice(2, 10).toLowerCase();
}

function assertSelectorPresent(code: string, signature: string) {
  const sel = selector(signature);
  if (!code.toLowerCase().includes(sel)) {
    throw new Error(`Factory bytecode 缺少函数选择器: ${signature} (${sel})`);
  }
}

async function main() {
  const { ethers: hhEthers } = await networkModule.connect();
  const provider = hhEthers.provider;
  const network = await provider.getNetwork();
  const pk = loadSignerPk();
  const signer = new hhEthers.Wallet(pk, provider);

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const factoryFile = path.join(deploymentsDir, "base-UserCardFactory.json");
  const modulesFile = path.join(deploymentsDir, "base-UserCardModules.json");

  if (!fs.existsSync(factoryFile)) {
    throw new Error("缺少 deployments/base-UserCardFactory.json，请先完成 Factory 部署");
  }

  const factoryData = JSON.parse(fs.readFileSync(factoryFile, "utf-8"));
  const factoryAddress = factoryData?.contracts?.beamioUserCardFactoryPaymaster?.address;
  if (!factoryAddress) {
    throw new Error("base-UserCardFactory.json 中缺少 beamioUserCardFactoryPaymaster.address");
  }

  const factoryCode = await provider.getCode(factoryAddress);
  ensureCode(factoryCode, "Factory", factoryAddress);

  console.log("=".repeat(60));
  console.log("部署并绑定 UserCard 模块");
  console.log("=".repeat(60));
  console.log("网络:", network.name, "chainId:", Number(network.chainId));
  console.log("签名账户:", signer.address);
  console.log("Factory:", factoryAddress);

  const ownerAbi = ["function owner() view returns (address)"];
  const ownerReader = new hhEthers.Contract(factoryAddress, ownerAbi, provider);
  const owner = (await ownerReader.owner()) as string;
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`当前 signer 非 factory owner。owner=${owner}, signer=${signer.address}`);
  }

  const RedeemFactory = await hhEthers.getContractFactory("BeamioUserCardRedeemModuleVNext");
  const IssuedFactory = await hhEthers.getContractFactory("BeamioUserCardIssuedNftModuleV1");
  const FaucetFactory = await hhEthers.getContractFactory("BeamioUserCardFaucetModuleV1");
  const GovernanceFactory = await hhEthers.getContractFactory("BeamioUserCardGovernanceModuleV1");

  const redeem = await RedeemFactory.connect(signer).deploy();
  await redeem.waitForDeployment();
  const issued = await IssuedFactory.connect(signer).deploy();
  await issued.waitForDeployment();
  const faucet = await FaucetFactory.connect(signer).deploy();
  await faucet.waitForDeployment();
  const governance = await GovernanceFactory.connect(signer).deploy();
  await governance.waitForDeployment();

  const modules: ModuleAddresses = {
    redeemModule: await redeem.getAddress(),
    issuedNftModule: await issued.getAddress(),
    faucetModule: await faucet.getAddress(),
    governanceModule: await governance.getAddress(),
  };

  console.log("RedeemModule:", modules.redeemModule);
  console.log("IssuedNftModule:", modules.issuedNftModule);
  console.log("FaucetModule:", modules.faucetModule);
  console.log("GovernanceModule:", modules.governanceModule);

  const factoryAbi = [
    "function setRedeemModule(address m) external",
    "function setIssuedNftModule(address m) external",
    "function setFaucetModule(address m) external",
    "function setGovernanceModule(address m) external",
    "function defaultRedeemModule() view returns (address)",
    "function defaultIssuedNftModule() view returns (address)",
    "function defaultFaucetModule() view returns (address)",
    "function defaultGovernanceModule() view returns (address)",
  ];
  const factory = new hhEthers.Contract(factoryAddress, factoryAbi, signer);

  await (await factory.setRedeemModule(modules.redeemModule)).wait();
  await (await factory.setIssuedNftModule(modules.issuedNftModule)).wait();
  await (await factory.setFaucetModule(modules.faucetModule)).wait();
  await (await factory.setGovernanceModule(modules.governanceModule)).wait();

  const bound = {
    redeem: (await factory.defaultRedeemModule()) as string,
    issued: (await factory.defaultIssuedNftModule()) as string,
    faucet: (await factory.defaultFaucetModule()) as string,
    governance: (await factory.defaultGovernanceModule()) as string,
  };

  if (bound.redeem.toLowerCase() !== modules.redeemModule.toLowerCase()) throw new Error("setRedeemModule 未生效");
  if (bound.issued.toLowerCase() !== modules.issuedNftModule.toLowerCase()) throw new Error("setIssuedNftModule 未生效");
  if (bound.faucet.toLowerCase() !== modules.faucetModule.toLowerCase()) throw new Error("setFaucetModule 未生效");
  if (bound.governance.toLowerCase() !== modules.governanceModule.toLowerCase()) throw new Error("setGovernanceModule 未生效");

  const deployedFactoryCode = await provider.getCode(factoryAddress);
  assertSelectorPresent(
    deployedFactoryCode,
    "appendTierForCardWithOwnerSignature(address,uint256,uint256,uint256,bool,uint256,bytes32,bytes)"
  );
  assertSelectorPresent(
    deployedFactoryCode,
    "createCardCollectionWithInitCodeAndTiers(address,uint8,uint256,bytes,(uint256,uint256,uint256,bool)[])"
  );

  const moduleDeployment = {
    network: network.name,
    chainId: network.chainId.toString(),
    timestamp: new Date().toISOString(),
    signer: signer.address,
    factory: factoryAddress,
    modules,
    checks: {
      appendTierForCardWithOwnerSignature: true,
      createCardCollectionWithInitCodeAndTiers: true,
    },
  };
  fs.writeFileSync(modulesFile, JSON.stringify(moduleDeployment, null, 2));

  factoryData.contracts.beamioUserCardFactoryPaymaster.redeemModule = modules.redeemModule;
  factoryData.contracts.beamioUserCardFactoryPaymaster.issuedNftModule = modules.issuedNftModule;
  factoryData.contracts.beamioUserCardFactoryPaymaster.faucetModule = modules.faucetModule;
  factoryData.contracts.beamioUserCardFactoryPaymaster.governanceModule = modules.governanceModule;
  fs.writeFileSync(factoryFile, JSON.stringify(factoryData, null, 2));

  console.log("绑定完成并写入:");
  console.log(" -", modulesFile);
  console.log(" -", factoryFile);
  console.log("功能检查通过: appendTierForCardWithOwnerSignature / createCardCollectionWithInitCodeAndTiers");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
