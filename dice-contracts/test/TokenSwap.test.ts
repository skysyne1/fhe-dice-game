import { expect } from "chai";
import { ethers, deployments, fhevm } from "hardhat";
import type { FHETokenSwap } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";

/**
 * Token Swap Tests
 * ================
 *
 * Tests for ETH ↔ ROLL token swapping:
 * - Swap ETH for ROLL
 * - Swap ROLL for ETH
 * - Swap calculations and balance updates
 *
 * Run with: npx hardhat test test/TokenSwap.test.ts
 */

describe("Token Swap", function () {
  let contract: FHETokenSwap;
  let owner: any, player1: any;
  let contractAddress: string;

  const ETH_SWAP_AMOUNT = "0.1"; // 0.1 ETH = 100 ROLL tokens

  beforeEach(async function () {
    // Initialize FHEVM for each test
    await fhevm.initializeCLIApi();

    // Get signers
    [owner, player1] = await ethers.getSigners();

    // Deploy contracts fresh for each test
    await deployments.fixture(["EncryptedDiceGame"]);
    const deployment = await deployments.get("FHETokenSwap");
    contractAddress = deployment.address;

    // Get contract instance
    contract = await ethers.getContractAt("FHETokenSwap", contractAddress);
  });

  describe("ETH to ROLL Swap", function () {
    it("Should swap ETH for ROLL tokens", async function () {
      const ethAmount = ethers.parseEther(ETH_SWAP_AMOUNT);
      const expectedRollAmount = parseFloat(ETH_SWAP_AMOUNT) * 1000;

      const tx = await contract.connect(player1).swapETHForROLL({ value: ethAmount });
      await tx.wait();

      const encryptedBalance = await contract.getBalance(player1.address);
      const clearBalance = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        encryptedBalance,
        contractAddress,
        player1,
      );
      expect(clearBalance).to.equal(expectedRollAmount);

      console.log(`✅ Player1 swapped ${ETH_SWAP_AMOUNT} ETH for ${expectedRollAmount} ROLL tokens`);
    });

    it("Should emit TokensSwapped event for ETH→ROLL", async function () {
      const ethAmount = ethers.parseEther(ETH_SWAP_AMOUNT);
      const expectedRollAmount = parseFloat(ETH_SWAP_AMOUNT) * 1000;

      await expect(contract.connect(player1).swapETHForROLL({ value: ethAmount }))
        .to.emit(contract, "TokensSwapped")
        .withArgs(player1.address, ethAmount, expectedRollAmount, true);

      console.log("✅ TokensSwapped event emitted correctly for ETH→ROLL");
    });

    it("Should reject zero ETH amount", async function () {
      await expect(contract.connect(player1).swapETHForROLL({ value: 0 })).to.be.revertedWithCustomError(
        contract,
        "NoETHSent",
      );

      console.log("✅ Correctly rejected zero ETH amount");
    });
  });

  describe("ROLL to ETH Swap", function () {
    beforeEach(async function () {
      // Mint tokens for testing
      await contract.connect(player1).mintTokens(1000);

      // Add ETH to contract treasury
      await contract.connect(owner).addTreasuryETH({ value: ethers.parseEther("1") });
    });

    it("Should swap ROLL for ETH tokens", async function () {
      // Get initial balances
      const initialETHBalance = await ethers.provider.getBalance(player1.address);
      const initialContractBalance = await contract.getContractETHBalance();

      // Create encrypted input
      const encryptedInput = await fhevm.createEncryptedInput(contractAddress, player1.address);
      const encryptedAmount = encryptedInput.add32(500); // 500 ROLL
      const encryptedValues = await encryptedInput.encrypt();

      // Swap ROLL → ETH
      const tx = await contract
        .connect(player1)
        .swapROLLForETH(500, encryptedValues.handles[0], encryptedValues.inputProof);
      const receipt = await tx.wait();

      // Verify ROLL balance decreased
      const finalEncryptedBalance = await contract.getBalance(player1.address);
      const finalClearBalance = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        finalEncryptedBalance,
        contractAddress,
        player1,
      );
      expect(finalClearBalance).to.equal(500); // 1000 - 500

      // Verify contract ETH balance decreased
      const finalContractBalance = await contract.getContractETHBalance();
      const expectedETHAmount = (500n * ethers.parseEther("1")) / 1000n; // 0.5 ETH
      expect(finalContractBalance).to.equal(initialContractBalance - expectedETHAmount);

      console.log(`✅ Player1 swapped 500 ROLL for ${ethers.formatEther(expectedETHAmount)} ETH`);
    });

    it("Should emit TokensSwapped event for ROLL→ETH", async function () {
      const rollAmount = 500;
      const expectedETHAmount = (BigInt(rollAmount) * ethers.parseEther("1")) / 1000n;

      const encryptedInput = await fhevm.createEncryptedInput(contractAddress, player1.address);
      const encryptedAmount = encryptedInput.add32(rollAmount);
      const encryptedValues = await encryptedInput.encrypt();

      await expect(
        contract
          .connect(player1)
          .swapROLLForETH(rollAmount, encryptedValues.handles[0], encryptedValues.inputProof),
      )
        .to.emit(contract, "TokensSwapped")
        .withArgs(player1.address, expectedETHAmount, rollAmount, false);

      console.log("✅ TokensSwapped event emitted correctly for ROLL→ETH");
    });

    it("Should reject zero ROLL amount", async function () {
      const encryptedInput = await fhevm.createEncryptedInput(contractAddress, player1.address);
      const encryptedAmount = encryptedInput.add32(0);
      const encryptedValues = await encryptedInput.encrypt();

      await expect(
        contract.connect(player1).swapROLLForETH(0, encryptedValues.handles[0], encryptedValues.inputProof),
      ).to.be.revertedWith("Amount must be greater than 0");

      console.log("✅ Correctly rejected zero ROLL amount");
    });

    it("Should reject swap when contract has insufficient ETH", async function () {
      // Try to swap more ROLL than contract has ETH for
      const rollAmount = 2000; // Would require 2 ETH, but contract only has 1 ETH

      const encryptedInput = await fhevm.createEncryptedInput(contractAddress, player1.address);
      const encryptedAmount = encryptedInput.add32(rollAmount);
      const encryptedValues = await encryptedInput.encrypt();

      await expect(
        contract
          .connect(player1)
          .swapROLLForETH(rollAmount, encryptedValues.handles[0], encryptedValues.inputProof),
      ).to.be.revertedWith("Insufficient contract ETH balance");

      console.log("✅ Correctly rejected swap with insufficient contract ETH");
    });
  });
});

