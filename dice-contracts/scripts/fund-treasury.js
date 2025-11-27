const { ethers } = require('hardhat');
const readline = require('readline');

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
  const defaultContractAddress = '0x3160Fd44b86Ec234d773b6426cC10B7B6C7daD6d';
  const defaultAmountEth = '0.0017';

  // Enter contract address (with default value)
  let contractAddress = await askQuestion(
    `Enter contract address to fund (press Enter to use default ${defaultContractAddress}): `
  );
  contractAddress = contractAddress.trim() || defaultContractAddress;

  if (!ethers.isAddress(contractAddress)) {
    throw new Error(`Invalid contract address: ${contractAddress}`);
  }

  // Enter ETH amount (with default value)
  let amountEth = await askQuestion(
    `Enter ETH amount to fund (press Enter to use default ${defaultAmountEth}): `
  );
  amountEth = amountEth.trim() || defaultAmountEth;

  if (Number.isNaN(Number(amountEth)) || Number(amountEth) <= 0) {
    throw new Error(`Invalid ETH amount: ${amountEth}`);
  }

  // Connect to deployer wallet
    const [deployer] = await ethers.getSigners();
    console.log('Using wallet:', deployer.address);

  // Check current treasury balance
    const currentBalance = await ethers.provider.getBalance(contractAddress);
    console.log('Current treasury balance:', ethers.formatEther(currentBalance), 'ETH');

  // Fund treasury by sending ETH directly
  console.log(`Sending ${amountEth} ETH to contract treasury...`);
    const tx = await deployer.sendTransaction({
        to: contractAddress,
    value: ethers.parseEther(amountEth),
  });
  await tx.wait();
    console.log('Treasury funded successfully! Transaction hash:', tx.hash);

  // Check treasury balance after funding
    const newBalance = await ethers.provider.getBalance(contractAddress);
    console.log('Contract address (treasury):', contractAddress);
    console.log('New treasury balance:', ethers.formatEther(newBalance), 'ETH');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});