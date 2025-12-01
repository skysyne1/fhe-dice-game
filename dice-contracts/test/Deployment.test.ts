import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import type { FHETokenSwap } from "../types";

/**
 * Contract Deployment Tests
 * =========================
 *
 * Tests for contract deployment and initialization:
 * - Owner setup
 * - Constants verification (ROLL_TOKEN_RATE, MAX_MINT)
 *
 * Run with: npx hardhat test test/Deployment.test.ts
 */

describe("Contract Deployment", function () {
  let contract: FHETokenSwap;
  let owner: any;
  let contractAddress: string;

  beforeEach(async function () {
    // Get signers
    [owner] = await ethers.getSigners();

    // Deploy contracts fresh for each test
    await deployments.fixture(["EncryptedDiceGame"]);
    const deployment = await deployments.get("FHETokenSwap");
    contractAddress = deployment.address;

    // Get contract instance
    contract = await ethers.getContractAt("FHETokenSwap", contractAddress);
  });

  describe("Initial State", function () {
    it("Should set the right owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
      console.log("✅ Contract deployed with correct owner");
    });
  });

  describe("Constants", function () {
    it("Should have correct ROLL_TOKEN_RATE", async function () {
      expect(await contract.ROLL_TOKEN_RATE()).to.equal(1000);
      console.log("✅ ROLL_TOKEN_RATE constant verified: 1000");
    });

    it("Should have correct MAX_MINT", async function () {
      const maxMint = await contract.MAX_MINT();
      expect(maxMint).to.equal(ethers.parseEther("10000"));
      console.log("✅ MAX_MINT constant verified: 10000 ROLL");
    });
  });
});

