/**
 * Contract addresses for EncryptedDiceGame across different networks
 * Generated from deployment results
 */
import deployedContracts from "./deployedContracts";

export const EncryptedDiceGameAddresses = {
  // Hardhat Local Network (Chain ID: 31337)
  31337: "0x5FbDB2315678afecb367f032d93F642f64180aa3",

  // Sepolia Testnet (Chain ID: 11155111) - add when deployed
  // 11155111: deployedContracts[11155111].EncryptedDiceGame.address,

  // Add other networks as needed
  // 1: "0x...", // Ethereum Mainnet
} as const;

export type SupportedChainId = keyof typeof EncryptedDiceGameAddresses;

/**
 * Get contract address for the given chain ID
 * @param chainId - The chain ID to get the address for
 * @returns The contract address or undefined if not deployed on that chain
 */
export function getEncryptedDiceGameAddress(chainId: number): string | undefined {
  return EncryptedDiceGameAddresses[chainId as SupportedChainId];
}
