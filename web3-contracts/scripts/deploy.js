const hre = require("hardhat");

async function main() {
  console.log("Deploying contracts...");

  // Deploy Token contract first
  const Token = await hre.ethers.getContractFactory("Token");
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  // const treasuryAddress = await token.treasury();
  console.log("Token contract deployed to:", tokenAddress);

  // Deploy Roulette contract with Token address
  const Roulette = await hre.ethers.getContractFactory("Roulette");
  const roulette = await Roulette.deploy(tokenAddress);
  await roulette.waitForDeployment();
  const rouletteAddress = await roulette.getAddress();
  console.log("Roulette contract deployed to:", rouletteAddress);

  // Set Roulette contract address in Token contract
  const setRouletteTx = await token.setRouletteContract(rouletteAddress);
  await setRouletteTx.wait();
  console.log("Roulette contract address set in Token contract");

  console.log("Deployment completed!");
  console.log("Token Address:", tokenAddress);
  console.log("Roulette Address:", rouletteAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 