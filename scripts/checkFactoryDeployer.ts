import { network as networkModule } from "hardhat";

async function main() {
  const { ethers } = await networkModule.connect();
  const factoryAddress = "0xa6B61e49A754567638891580C617D6912268674f";
  
  const factory = await ethers.getContractAt("BeamioFactoryPaymasterV07", factoryAddress);
  const deployerAddress = await factory.deployer();
  console.log("Deployer address:", deployerAddress);
  
  const deployer = await ethers.getContractAt("BeamioAccountDeployer", deployerAddress);
  const deployerFactory = await deployer.factory();
  console.log("Deployer's factory:", deployerFactory);
  console.log("Factory address:", factoryAddress);
  console.log("Match:", deployerFactory.toLowerCase() === factoryAddress.toLowerCase());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
