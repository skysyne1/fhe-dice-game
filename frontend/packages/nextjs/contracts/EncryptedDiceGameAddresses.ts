/**
 * Contract addresses for EncryptedDiceGame across different networks
 * Generated from deployment results
 */
import deployedContracts from "./deployedContracts";

export const EncryptedDiceGameAddresses = {
  // Hardhat Local Network (Chain ID: 31337)
  31337: "0xb87016578Ad00e7bAAF1d9D99296df7d215A62b2",

  // Sepolia Testnet (Chain ID: 11155111)
  11155111: "0x270cEba37b81a2CE103E5E76a5b794eb33cDf101",

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
