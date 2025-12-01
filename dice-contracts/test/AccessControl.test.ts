import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import type { FHETokenSwap } from "../types";

/**
 * Access Control Tests
 * ====================
 *
 * Tests for access control:
 * - Owner-only functions
 * - Withdraw ETH (owner only)
 *
 * Run with: npx hardhat test test/AccessControl.test.ts
 */

describe("Access Control", function () {
  let contract: FHETokenSwap;
  let owner: any, player1: any;
  let contractAddress: string;

  beforeEach(async function () {
    // Get signers
    [owner, player1] = await ethers.getSigners();

    // Deploy contracts fresh for each test
    await deployments.fixture(["EncryptedDiceGame"]);
    const deployment = await deployments.get("FHETokenSwap");
    contractAddress = deployment.address;

    // Get contract instance
    contract = await ethers.getContractAt("FHETokenSwap", contractAddress);
  });

  describe("Withdraw ETH", function () {
    beforeEach(async function () {
      // Send some ETH to contract
      await player1.sendTransaction({
        to: contractAddress,
        value: ethers.parseEther("1"),
      });
    });

    it("Should only allow owner to withdraw ETH", async function () {
      const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
      const contractBalance = await contract.getContractETHBalance();

      // Non-owner should not be able to withdraw
      await expect(contract.connect(player1).withdrawETH()).to.be.revertedWithCustomError(contract, "OnlyOwner");

      // Owner should be able to withdraw
      const tx = await contract.connect(owner).withdrawETH();
      const receipt = await tx.wait();

      // Verify contract balance is now zero
      const finalContractBalance = await contract.getContractETHBalance();
      expect(finalContractBalance).to.equal(0);

      console.log("✅ Owner successfully withdrew ETH from contract");
    });

    it("Should transfer all ETH to owner", async function () {
      const contractBalanceBefore = await contract.getContractETHBalance();
      expect(contractBalanceBefore).to.be.gt(0);

      const tx = await contract.connect(owner).withdrawETH();
      await tx.wait();

      const contractBalanceAfter = await contract.getContractETHBalance();
      expect(contractBalanceAfter).to.equal(0);

      console.log("✅ All ETH transferred to owner");
    });
  });

  describe("Owner Modifier", function () {
    it("Should correctly identify owner", async function () {
      const contractOwner = await contract.owner();
      expect(contractOwner).to.equal(owner.address);

      console.log("✅ Owner correctly identified");
    });

    it("Should reject non-owner for owner-only functions", async function () {
      // Test with addTreasuryETH (owner-only)
      await expect(contract.connect(player1).addTreasuryETH({ value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
        contract,
        "OnlyOwner",
      );

      console.log("✅ OnlyOwner modifier working correctly");
    });
  });
});

