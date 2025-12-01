import { expect } from "chai";
import { ethers, deployments, fhevm } from "hardhat";
import type { FHETokenSwap } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";

/**
 * Balance Tests
 * =============
 *
 * Tests for balance operations:
 * - Get encrypted balance
 * - Balance decryption
 * - Balance updates after operations
 *
 * Run with: npx hardhat test test/Balance.test.ts
 */

describe("Balance Operations", function () {
  let contract: FHETokenSwap;
  let owner: any, player1: any, player2: any;
  let contractAddress: string;

  beforeEach(async function () {
    // Initialize FHEVM for each test
    await fhevm.initializeCLIApi();

    // Get signers
    [owner, player1, player2] = await ethers.getSigners();

    // Deploy contracts fresh for each test
    await deployments.fixture(["EncryptedDiceGame"]);
    const deployment = await deployments.get("FHETokenSwap");
    contractAddress = deployment.address;

    // Get contract instance
    contract = await ethers.getContractAt("FHETokenSwap", contractAddress);
  });

  describe("Balance Retrieval", function () {
    it("Should return encrypted balance for player", async function () {
      // Mint tokens first
      await contract.connect(player1).mintTokens(1000);

      const encryptedBalance = await contract.getBalance(player1.address);
      expect(encryptedBalance).to.not.equal(ethers.ZeroHash);

      console.log("✅ Encrypted balance retrieved successfully");
    });

    it("Should return zero balance for new player", async function () {
      const encryptedBalance = await contract.getBalance(player2.address);
      
      // Decrypt and verify it's zero
      const clearBalance = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        encryptedBalance,
        contractAddress,
        player2,
      );
      expect(clearBalance).to.equal(0);

      console.log("✅ Zero balance returned for new player");
    });
  });

  describe("Balance Decryption", function () {
    it("Should decrypt balance correctly after mint", async function () {
      const mintAmount = 500;
      await contract.connect(player1).mintTokens(mintAmount);

      const encryptedBalance = await contract.getBalance(player1.address);
      const clearBalance = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        encryptedBalance,
        contractAddress,
        player1,
      );
      expect(clearBalance).to.equal(mintAmount);

      console.log(`✅ Balance decrypted correctly: ${clearBalance} ROLL`);
    });

    it("Should decrypt balance correctly after swap", async function () {
      const ethAmount = ethers.parseEther("0.1");
      const expectedRollAmount = 100; // 0.1 ETH * 1000

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

      console.log(`✅ Balance decrypted correctly after swap: ${clearBalance} ROLL`);
    });
  });

  describe("Multiple Players Balance", function () {
    it("Should handle multiple players independently", async function () {
      // Both players mint tokens
      await contract.connect(player1).mintTokens(500);
      await contract.connect(player2).mintTokens(800);

      // Verify independent balances
      const balance1 = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        await contract.getBalance(player1.address),
        contractAddress,
        player1,
      );
      const balance2 = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        await contract.getBalance(player2.address),
        contractAddress,
        player2,
      );

      expect(balance1).to.equal(500);
      expect(balance2).to.equal(800);

      console.log(`✅ Independent balances verified: Player1=${balance1}, Player2=${balance2}`);
    });
  });
});

