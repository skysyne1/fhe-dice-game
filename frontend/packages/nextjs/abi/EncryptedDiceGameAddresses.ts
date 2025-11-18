import { type Chain } from "viem";

export type EncryptedDiceGameInfo = {
  address: `0x${string}`;
  abi: typeof import("./EncryptedDiceGameABI").EncryptedDiceGameABI;
};

type EncryptedDiceGameAddressMap = {
  [key: number]: EncryptedDiceGameInfo;
};

export const encryptedDiceGameAddresses: EncryptedDiceGameAddressMap = {
  // Localhost/Hardhat Network
  31337: {
    address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", // Updated after deployment
    abi: require("./EncryptedDiceGameABI").EncryptedDiceGameABI,
  },

  // Sepolia Testnet
  11155111: {
    address: "0x270cEba37b81a2CE103E5E76a5b794eb33cDf101", // Deployed with FHEVM v0.9.1 + public decryption support
    abi: require("./EncryptedDiceGameABI").EncryptedDiceGameABI,
  },

  // Ethereum Mainnet (for future use)
  1: {
    address: "0x0000000000000000000000000000000000000000", // Will be updated after deployment
    abi: require("./EncryptedDiceGameABI").EncryptedDiceGameABI,
  },
} as const;

export function getEncryptedDiceGameInfo(chainId: number): EncryptedDiceGameInfo | undefined {
  return encryptedDiceGameAddresses[chainId];
}

export function getEncryptedDiceGameAddress(chainId: number): `0x${string}` | undefined {
  return encryptedDiceGameAddresses[chainId]?.address;
}
