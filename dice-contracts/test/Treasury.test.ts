import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import type { FHETokenSwap } from "../types";

/**
 * Treasury Tests
 * ==============
 *
 * Tests for treasury management:
 * - Add ETH to treasury (owner only)
 * - Get contract ETH balance
 * - Access control
 *
 * Run with: npx hardhat test test/Treasury.test.ts
 */

describe("Treasury Management", function () {
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

  describe("Contract ETH Balance", function () {
    it("Should return correct contract ETH balance", async function () {
      // Send ETH to contract
      await player1.sendTransaction({
        to: contractAddress,
        value: ethers.parseEther("1"),
      });

      const balance = await contract.getContractETHBalance();
      expect(balance).to.equal(ethers.parseEther("1"));

      console.log(`✅ Contract ETH balance verified: ${ethers.formatEther(balance)} ETH`);
    });

    it("Should return zero balance initially", async function () {
      const balance = await contract.getContractETHBalance();
      expect(balance).to.equal(0);

      console.log("✅ Initial contract ETH balance is zero");
    });
  });

  describe("Add Treasury ETH", function () {
    it("Should allow owner to add ETH to treasury", async function () {
      const initialBalance = await contract.getContractETHBalance();

      await expect(contract.connect(owner).addTreasuryETH({ value: ethers.parseEther("1") }))
        .to.emit(contract, "TreasuryFunded")
        .withArgs(owner.address, ethers.parseEther("1"));

      const finalBalance = await contract.getContractETHBalance();
      expect(finalBalance).to.equal(initialBalance + ethers.parseEther("1"));

      console.log(`✅ Owner added 1 ETH to treasury`);
    });

    it("Should reject non-owner from adding ETH to treasury", async function () {
      await expect(contract.connect(player1).addTreasuryETH({ value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
        contract,
        "OnlyOwner",
      );

      console.log(`✅ Correctly rejected non-owner from adding ETH to treasury`);
    });

    it("Should reject zero ETH amount", async function () {
      await expect(contract.connect(owner).addTreasuryETH({ value: 0 })).to.be.revertedWith("Must send ETH");

      console.log("✅ Correctly rejected zero ETH amount");
    });

    it("Should accumulate multiple treasury additions", async function () {
      await contract.connect(owner).addTreasuryETH({ value: ethers.parseEther("1") });
      await contract.connect(owner).addTreasuryETH({ value: ethers.parseEther("0.5") });

      const balance = await contract.getContractETHBalance();
      expect(balance).to.equal(ethers.parseEther("1.5"));

      console.log("✅ Multiple treasury additions accumulated correctly");
    });
  });
});

