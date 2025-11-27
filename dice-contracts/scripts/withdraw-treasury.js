const { ethers } = require("hardhat");
const readline = require("readline");

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const defaultContractAddress = "0x3160Fd44b86Ec234d773b6426cC10B7B6C7daD6d";

  // Enter contract address (with default value)
  let contractAddress = await askQuestion(
    `Enter contract address to withdraw from (press Enter to use default ${defaultContractAddress}): `
  );
  contractAddress = contractAddress.trim() || defaultContractAddress;

  if (!ethers.isAddress(contractAddress)) {
    throw new Error(`Invalid contract address: ${contractAddress}`);
  }

  // Get deployer wallet (should be the owner if deployed with Hardhat mnemonic)
  const [deployer] = await ethers.getSigners();
  console.log("Using wallet (must be owner):", deployer.address);

  // Connect to EncryptedDiceGame contract
  const dice = await ethers.getContractAt("EncryptedDiceGame", contractAddress);

  // Log contract balance before withdrawal
  const contractBalanceBefore = await ethers.provider.getBalance(contractAddress);
  console.log("Contract balance before:", ethers.formatEther(contractBalanceBefore), "ETH");

  if (contractBalanceBefore === 0n) {
    console.log("Contract balance is zero, nothing to withdraw.");
    return;
  }

  const deployerBalanceBefore = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance before:", ethers.formatEther(deployerBalanceBefore), "ETH");

  console.log("Calling withdrawETH() to transfer all contract ETH to owner...");
  const tx = await dice.withdrawETH(); // always withdraws full contract balance to owner
  console.log("Withdraw transaction sent. Hash:", tx.hash);
  await tx.wait();

  const contractBalanceAfter = await ethers.provider.getBalance(contractAddress);
  const deployerBalanceAfter = await ethers.provider.getBalance(deployer.address);

  console.log("Contract balance after:", ethers.formatEther(contractBalanceAfter), "ETH");
  console.log("Deployer balance after:", ethers.formatEther(deployerBalanceAfter), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
