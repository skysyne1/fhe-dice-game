"use client";

import { useCallback, useEffect, useState } from "react";
import { EncryptedDiceGameABI } from "../abi/EncryptedDiceGameABI";
import { getEncryptedDiceGameAddress } from "../abi/EncryptedDiceGameAddresses";
import { useDecryptedBalance } from "../contexts/DecryptedBalanceContext";
import { ethers } from "ethers";
import { initializeFheInstance, useContract, useEncrypt } from "fhevm-sdk";
import { decodeEventLog } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWalletClient,
  useWriteContract,
} from "wagmi";

export type SwapRecord = {
  id: string; // Transaction hash
  timestamp: number;
  ethAmount: bigint;
  rollAmount: bigint;
  direction: "ETH_TO_ROLL" | "ROLL_TO_ETH";
};

export type TransferRecord = {
  id: string; // Transaction hash
  timestamp: number;
  from: string; // Sender address
  to: string; // Recipient address
  amount: bigint; // ROLL amount transferred
  type: "SENT" | "RECEIVED"; // Type based on current user
};

export function useEncryptedDiceGame() {
  const { address: walletAddress, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  // FHEVM instance state
  const [isInitialized, setIsInitialized] = useState(false);
  const [fhevmStatus, setFhevmStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  // New FHEVM 0.9 hooks
  const { encrypt, isEncrypting, error: encryptError } = useEncrypt();

  // Initialize FHEVM on component mount
  // According to Zama documentation, FHEVM only works on Sepolia (chainId: 11155111)
  useEffect(() => {
    const initFhevm = async () => {
      // Only initialize if we have a chainId and it's Sepolia
      const SEPOLIA_CHAIN_ID = 11155111;
      if (!chainId) {
        setFhevmStatus("idle");
        return;
      }

      if (chainId !== SEPOLIA_CHAIN_ID) {
        console.warn(
          `⚠️ FHEVM is only supported on Sepolia testnet (chainId: ${SEPOLIA_CHAIN_ID}). ` +
            `Current network chainId: ${chainId}. FHEVM features will not be available.`,
        );
        setFhevmStatus("error");
        return;
      }

      try {
        setFhevmStatus("loading");
        await initializeFheInstance({ chainId });
        setIsInitialized(true);
        setFhevmStatus("ready");
        console.log("✅ FHEVM initialized successfully");
      } catch (error) {
        console.error("❌ FHEVM initialization failed:", error);
        setFhevmStatus("error");
      }
    };

    if (typeof window !== "undefined" && window.ethereum) {
      initFhevm();
    }
  }, [chainId]);

  // Contract info
  const contractAddress = chainId ? getEncryptedDiceGameAddress(chainId) : undefined;

  // Auto-clear cache when contract address changes
  const { clearCache } = useDecryptedBalance();

  useEffect(() => {
    const STORAGE_KEY = "fhe-token-swap-contract-address";

    if (contractAddress) {
      try {
        const savedAddress = localStorage.getItem(STORAGE_KEY);

        if (savedAddress && savedAddress !== contractAddress) {
          console.log("🔄 Contract address changed, clearing cache...");
          console.log("  Old:", savedAddress);
          console.log("  New:", contractAddress);
          clearCache();
        }

        localStorage.setItem(STORAGE_KEY, contractAddress);
      } catch (error) {
        console.warn("Failed to handle contract address change:", error);
      }
    }
  }, [contractAddress, clearCache]);

  // Wagmi hooks
  const { writeContractAsync, data: writeData, isPending: isWritePending } = useWriteContract();
  const { isLoading: isTransactionLoading } = useWaitForTransactionReceipt({
    hash: writeData,
  });

  // Contract hook from new SDK
  const { contract: readContract } = useContract(contractAddress || "", EncryptedDiceGameABI as any);

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swapHistory, setSwapHistory] = useState<SwapRecord[]>([]);
  const [transferHistory, setTransferHistory] = useState<TransferRecord[]>([]);
  const [encryptedBalance, setEncryptedBalance] = useState<string>("");
  const [decryptedBalance, setDecryptedBalance] = useState<number | undefined>(undefined);

  // Note: FHEVM initialization is handled by the useEffect above
  // Helper: convert Uint8Array or other types to 0x-prefixed hex string for viem/wagmi
  const toHexString = (value: any): `0x${string}` => {
    if (!value) return "0x" as `0x${string}`;

    if (typeof value === "string") {
      return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
    }

    if (value instanceof Uint8Array) {
      const hex = Array.from(value)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      return `0x${hex}` as `0x${string}`;
    }

    // Fallback: try toString and wrap
    const str = String(value);
    return `0x${str.replace(/^0x/, "")}` as `0x${string}`;
  };

  // Read encrypted balance using new pattern
  const { data: contractBalance, refetch: refetchBalance } = useReadContract({
    address: contractAddress as `0x${string}`,
    abi: EncryptedDiceGameABI,
    functionName: "getBalance",
    args: walletAddress ? [walletAddress] : undefined,
    query: {
      enabled: Boolean(walletAddress && contractAddress),
    },
  });

  // Update encrypted balance when contract data changes
  useEffect(() => {
    console.log("📊 Contract balance update:", contractBalance);
    if (contractBalance) {
      let balanceStr: string;
      if (typeof contractBalance === "bigint") {
        balanceStr = "0x" + contractBalance.toString(16);
      } else if (typeof contractBalance === "string") {
        balanceStr = contractBalance;
      } else {
        balanceStr = String(contractBalance);
      }
      console.log("💰 Setting encrypted balance:", balanceStr);
      setEncryptedBalance(balanceStr);
    }
  }, [contractBalance]);

  // Monitor transaction state
  useEffect(() => {
    if (writeData) {
      console.log("📝 Transaction hash received:", writeData);
    }
  }, [writeData]);

  // Load swap history from blockchain using TokensSwapped events
  const loadSwapHistory = useCallback(async () => {
    if (!walletAddress || !contractAddress || !publicClient) {
      setSwapHistory([]);
      return;
    }

    try {
      console.log("🔄 Loading swap history...", { walletAddress, contractAddress });

      // Get current block number to limit query range (RPC providers limit to 10000 blocks)
      const currentBlock = await publicClient.getBlockNumber();
      const MAX_BLOCKS_QUERY = 10000n;

      // Query from (currentBlock - 10000) or from block 0 if contract is newer
      // Contract was deployed around block 6,000,000+ on Sepolia, so we can safely query from a recent block
      const fromBlock = currentBlock > MAX_BLOCKS_QUERY ? currentBlock - MAX_BLOCKS_QUERY : 0n;

      console.log(`📊 Querying events from block ${fromBlock} to ${currentBlock} (${currentBlock - fromBlock} blocks)`);

      // Query TokensSwapped events to get all swaps for this user
      const events = await publicClient.getLogs({
        address: contractAddress as `0x${string}`,
        event: {
          type: "event",
          name: "TokensSwapped",
          inputs: [
            { type: "address", indexed: true, name: "user" },
            { type: "uint256", indexed: false, name: "ethAmount" },
            { type: "uint256", indexed: false, name: "rollAmount" },
            { type: "bool", indexed: false, name: "ethToRoll" },
          ],
        },
        args: {
          user: walletAddress as `0x${string}`,
        },
        fromBlock,
        toBlock: currentBlock,
      });

      console.log(`📊 Found ${events.length} swap events`);

      // Get block timestamps for all unique blocks
      const uniqueBlockNumbers = [...new Set(events.map((e: any) => e.blockNumber))];
      const blockTimestamps: Record<string, number> = {};

      // Fetch block timestamps in parallel
      await Promise.all(
        uniqueBlockNumbers.map(async (blockNumber: bigint) => {
          try {
            const block = await publicClient.getBlock({ blockNumber });
            blockTimestamps[blockNumber.toString()] = Number(block.timestamp);
          } catch (error) {
            console.warn(`Failed to get timestamp for block ${blockNumber}:`, error);
            // Fallback: estimate timestamp (12s per block on Sepolia)
            blockTimestamps[blockNumber.toString()] = Number(blockNumber) * 12;
          }
        }),
      );

      const swaps: SwapRecord[] = events.map((event: any, index: number) => {
        const args = event.args as any;
        // Get actual block timestamp or fallback to estimate
        const blockNumberStr = event.blockNumber?.toString() || "";
        const timestamp =
          blockTimestamps[blockNumberStr] || (event.blockNumber ? Number(event.blockNumber) * 12 : Date.now() / 1000);

        return {
          id: event.transactionHash || `swap-${index}`,
          timestamp: Math.floor(timestamp),
          ethAmount: typeof args.ethAmount === "bigint" ? args.ethAmount : BigInt(args.ethAmount || 0),
          rollAmount: typeof args.rollAmount === "bigint" ? args.rollAmount : BigInt(args.rollAmount || 0),
          direction: args.ethToRoll ? "ETH_TO_ROLL" : "ROLL_TO_ETH",
        };
      });

      const sortedSwaps = swaps.sort((a, b) => b.timestamp - a.timestamp);
      setSwapHistory(sortedSwaps);
      console.log(`✅ Loaded ${sortedSwaps.length} swaps into history`);
    } catch (error) {
      console.error("❌ Failed to load swap history:", error);
      setSwapHistory([]);
    }
  }, [walletAddress, contractAddress, publicClient]);

  // Load transfer history from blockchain using TokensTransferred events
  const loadTransferHistory = useCallback(async () => {
    if (!walletAddress || !contractAddress || !publicClient) {
      setTransferHistory([]);
      return;
    }

    try {
      console.log("🔄 Loading transfer history...", { walletAddress, contractAddress });

      // Get current block number to limit query range
      const currentBlock = await publicClient.getBlockNumber();
      const MAX_BLOCKS_QUERY = 10000n;
      const fromBlock = currentBlock > MAX_BLOCKS_QUERY ? currentBlock - MAX_BLOCKS_QUERY : 0n;

      console.log(`📊 Querying transfer events from block ${fromBlock} to ${currentBlock}`);

      // Query TokensTransferred events where user is sender
      const sentEvents = await publicClient.getLogs({
        address: contractAddress as `0x${string}`,
        event: {
          type: "event",
          name: "TokensTransferred",
          inputs: [
            { type: "address", indexed: true, name: "from" },
            { type: "address", indexed: true, name: "to" },
            { type: "uint256", indexed: false, name: "amount" },
          ],
        },
        args: {
          from: walletAddress as `0x${string}`,
        },
        fromBlock,
        toBlock: currentBlock,
      });

      // Query TokensTransferred events where user is receiver
      const receivedEvents = await publicClient.getLogs({
        address: contractAddress as `0x${string}`,
        event: {
          type: "event",
          name: "TokensTransferred",
          inputs: [
            { type: "address", indexed: true, name: "from" },
            { type: "address", indexed: true, name: "to" },
            { type: "uint256", indexed: false, name: "amount" },
          ],
        },
        args: {
          to: walletAddress as `0x${string}`,
        },
        fromBlock,
        toBlock: currentBlock,
      });

      // Combine and deduplicate events (same transaction hash)
      const allEvents = [...sentEvents, ...receivedEvents];
      const uniqueEvents = Array.from(new Map(allEvents.map((e: any) => [e.transactionHash, e])).values());

      console.log(`📊 Found ${uniqueEvents.length} transfer events`);

      // Get block timestamps for all unique blocks
      const uniqueBlockNumbers = [...new Set(uniqueEvents.map((e: any) => e.blockNumber))];
      const blockTimestamps: Record<string, number> = {};

      await Promise.all(
        uniqueBlockNumbers.map(async (blockNumber: bigint) => {
          try {
            const block = await publicClient.getBlock({ blockNumber });
            blockTimestamps[blockNumber.toString()] = Number(block.timestamp);
          } catch (error) {
            console.warn(`Failed to get timestamp for block ${blockNumber}:`, error);
            blockTimestamps[blockNumber.toString()] = Number(blockNumber) * 12;
          }
        }),
      );

      const transfers: TransferRecord[] = uniqueEvents.map((event: any, index: number) => {
        const args = event.args as any;
        const blockNumberStr = event.blockNumber?.toString() || "";
        const timestamp =
          blockTimestamps[blockNumberStr] || (event.blockNumber ? Number(event.blockNumber) * 12 : Date.now() / 1000);

        const fromAddress = typeof args.from === "string" ? args.from : args.from?.toString() || "";
        const toAddress = typeof args.to === "string" ? args.to : args.to?.toString() || "";
        const amount = typeof args.amount === "bigint" ? args.amount : BigInt(args.amount || 0);

        // Determine if this is a sent or received transfer
        const isSent = fromAddress.toLowerCase() === walletAddress?.toLowerCase();
        const type: "SENT" | "RECEIVED" = isSent ? "SENT" : "RECEIVED";

        return {
          id: event.transactionHash || `transfer-${index}`,
          timestamp: Math.floor(timestamp),
          from: fromAddress,
          to: toAddress,
          amount,
          type,
        };
      });

      const sortedTransfers = transfers.sort((a, b) => b.timestamp - a.timestamp);
      setTransferHistory(sortedTransfers);
      console.log(`✅ Loaded ${sortedTransfers.length} transfers into history`);
    } catch (error) {
      console.error("❌ Failed to load transfer history:", error);
      setTransferHistory([]);
    }
  }, [walletAddress, contractAddress, publicClient]);

  // Auto-load swap history when dependencies change
  useEffect(() => {
    loadSwapHistory();
  }, [loadSwapHistory]);

  // Auto-load transfer history when dependencies change
  useEffect(() => {
    loadTransferHistory();
  }, [loadTransferHistory]);

  // Note: makeBalancePublic removed as function doesn't exist in current ABI

  // Mint tokens for testing
  const mintTokens = useCallback(
    async (amount: number) => {
      console.log("🎯 mintTokens called with:", { amount, contractAddress, walletAddress });

      if (!contractAddress || !walletAddress) {
        console.error("❌ Missing required data:", { contractAddress, walletAddress });
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        console.log("🪙 Calling writeContractAsync...", {
          address: contractAddress,
          functionName: "mintTokens",
          args: [amount],
        });

        const txHash = await writeContractAsync({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "mintTokens",
          args: [BigInt(amount)], // Contract only takes amount, msg.sender is used automatically
        });

        console.log("✅ Mint transaction submitted!", txHash);
      } catch (error: any) {
        console.error("❌ Mint tokens failed:", error);

        // Better error messages
        let errorMessage = "Failed to mint tokens";
        if (error?.message?.includes("rejected")) {
          errorMessage = "Transaction was rejected";
        } else if (error?.message?.includes("insufficient funds")) {
          errorMessage = "Insufficient ETH for gas fees";
        } else if (error?.message?.includes("user denied")) {
          errorMessage = "Transaction was denied by user";
        }

        setError(errorMessage);
        throw error; // Re-throw so handleMintTokens can catch it
      } finally {
        setIsLoading(false);
      }
    },
    [contractAddress, walletAddress, writeContractAsync],
  );

  // Swap ETH for ROLL tokens
  // Contract uses euint32 with normalized ROLL units (no decimals)
  // Rate: 1 ETH = 1000 ROLL (ROLL has no decimals, 1 ROLL = 1 unit)
  const swapETHForROLL = useCallback(
    async (ethAmount: number) => {
      if (!contractAddress || !walletAddress) return;

      try {
        setIsLoading(true);
        setError(null);

        // Rate: 1 ETH = 1000 ROLL (ROLL without decimals)
        const expectedROLL = ethAmount * 1000;
        console.log(`🔄 Swapping ${ethAmount} ETH for ${expectedROLL} ROLL units`);

        // Contract calculation: rollAmount = (msg.value * ROLL_TOKEN_RATE) / 1e18
        // With msg.value in wei and ROLL_TOKEN_RATE = 1000:
        // For 1 ETH (1e18 wei): rollAmount = (1e18 * 1000) / 1e18 = 1000 ROLL units
        // Max: uint32.max = 4,294,967,295, so max ~4.3M ROLL = ~4,300 ETH

        // Check if expected ROLL amount fits in uint32
        if (expectedROLL > 4294967295) {
          throw new Error(`Amount too large - maximum ~4.3M ROLL (${4294967295 / 1000} ETH) per transaction`);
        }

        // Convert ETH to wei
        const ethAmountWei = BigInt(Math.round(ethAmount * 1e18));
        console.log(`📊 Sending ${ethAmountWei.toString()} wei to contract`);
        console.log(`📊 Expected ROLL: ${expectedROLL} ROLL units (no decimals)`);

        const txHash = await writeContractAsync({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "swapETHForROLL",
          args: [],
          value: ethAmountWei,
        });
        console.log("✅ ETH→ROLL swap transaction submitted!", txHash);
      } catch (error) {
        console.error("Swap ETH for ROLL failed:", error);
        setError("Failed to swap ETH for ROLL");
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [contractAddress, walletAddress, writeContractAsync],
  );

  // Swap ROLL for ETH tokens
  const swapROLLForETH = useCallback(
    async (rollAmount: number) => {
      // Validate prerequisites explicitly so we know why MetaMask doesn't open
      if (!contractAddress) {
        const err = new Error("Contract address is not available");
        console.error(err);
        setError(err.message);
        throw err;
      }

      if (!walletAddress) {
        const err = new Error("Wallet not connected");
        console.error(err);
        setError(err.message);
        throw err;
      }

      if (!walletClient) {
        const err = new Error("Wallet client not ready. Please reconnect your wallet.");
        console.error(err);
        setError(err.message);
        throw err;
      }

      if (!isInitialized) {
        const err = new Error("FHEVM not initialized. Please wait a moment and try again.");
        console.error(err);
        setError(err.message);
        throw err;
      }

      try {
        setIsLoading(true);
        setError(null);

        console.log(`🔄 Swapping ${rollAmount} ROLL for ETH`);

        // Encrypt ROLL amount
        const encryptedAmount = await encrypt(contractAddress, walletAddress, rollAmount);
        console.log("🔐 Encrypted data structure:", encryptedAmount);

        const txHash = await writeContractAsync({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "swapROLLForETH",
          args: [
            rollAmount, // plaintext rollAmount (uint32)
            toHexString(encryptedAmount.encryptedData), // encrypted handle from FHEVM SDK
            toHexString(encryptedAmount.proof), // proof from encrypted data
          ],
        });

        console.log("✅ ROLL→ETH swap transaction submitted!", txHash);
        // Note: Transaction confirmation will be handled by the component using useWaitForTransactionReceipt
      } catch (error) {
        console.error("Swap ROLL for ETH failed:", error);
        setError("Failed to swap ROLL for ETH");
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [contractAddress, walletAddress, walletClient, writeContractAsync, isInitialized, encrypt],
  );

  // Transfer ROLL tokens to another address
  const transferROLL = useCallback(
    async (recipientAddress: string, rollAmount: number) => {
      // Validate prerequisites
      if (!contractAddress) {
        const err = new Error("Contract address is not available");
        console.error(err);
        setError(err.message);
        throw err;
      }

      if (!walletAddress) {
        const err = new Error("Wallet not connected");
        console.error(err);
        setError(err.message);
        throw err;
      }

      if (!walletClient) {
        const err = new Error("Wallet client not ready. Please reconnect your wallet.");
        console.error(err);
        setError(err.message);
        throw err;
      }

      if (!isInitialized) {
        const err = new Error("FHEVM not initialized. Please wait a moment and try again.");
        console.error(err);
        setError(err.message);
        throw err;
      }

      try {
        setIsLoading(true);
        setError(null);

        console.log(`🔄 Transferring ${rollAmount} ROLL to ${recipientAddress}`);

        // Encrypt ROLL amount
        const encryptedAmount = await encrypt(contractAddress, walletAddress, rollAmount);
        console.log("🔐 Encrypted data structure:", encryptedAmount);

        // Submit transaction
        const txHash = await writeContractAsync({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "transferROLL",
          args: [
            recipientAddress as `0x${string}`,
            rollAmount,
            toHexString(encryptedAmount.encryptedData),
            toHexString(encryptedAmount.proof),
          ],
        });

        console.log("✅ Transfer transaction submitted!", txHash);
        // Note: Transaction confirmation will be handled by the component using useWaitForTransactionReceipt
      } catch (error) {
        console.error("Transfer failed:", error);
        setError("Failed to transfer ROLL");
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [contractAddress, walletAddress, walletClient, writeContractAsync, isInitialized, encrypt],
  );

  // Refresh data (balance + swap history + transfer history)
  const refresh = useCallback(async () => {
    console.log("🔄 Refreshing balance, swap history, and transfer history...");
    await Promise.all([refetchBalance(), loadSwapHistory(), loadTransferHistory()]);
    console.log("✅ Refresh complete");
  }, [refetchBalance, loadSwapHistory, loadTransferHistory]);

  // Auto-refresh on transaction completion
  useEffect(() => {
    if (writeData && !isTransactionLoading) {
      // Wait a bit for the transaction to be indexed
      const timer = setTimeout(() => {
        refresh();
      }, 2000); // 2 second delay to allow block indexing
      return () => clearTimeout(timer);
    }
  }, [writeData, isTransactionLoading, refresh]);

  return {
    // FHEVM status
    isInitialized,
    fhevmStatus,

    // Loading states
    isLoading: isLoading || isWritePending || isTransactionLoading || isEncrypting,
    isTransactionPending: isWritePending,
    isTransactionLoading,
    error: error || encryptError,

    // Swap history data
    swapHistory,

    // Transfer history data
    transferHistory,

    // Balance data
    encryptedBalance,

    // Contract info
    contractAddress,
    isContractAvailable: Boolean(contractAddress),
    isContractReady: Boolean(contractAddress && isInitialized),

    // Functions
    mintTokens,
    swapETHForROLL,
    swapROLLForETH,
    transferROLL,
    refresh,
    refreshBalance: async () => {
      console.log("🔄 Refreshing balance...");
      await refetchBalance();
      console.log("✅ Balance refresh complete");
    },

    // Owner functions
    addTreasuryETH: async (ethAmount: number) => {
      if (!contractAddress || !walletAddress) return;

      try {
        setIsLoading(true);
        setError(null);

        const ethAmountWei = BigInt(Math.round(ethAmount * 1e18));

        const txHash = await writeContractAsync({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "addTreasuryETH" as any,
          args: [],
          value: ethAmountWei as any,
        });

        console.log(`✅ Added ${ethAmount} ETH to contract treasury. Tx hash:`, txHash);
      } catch (error) {
        console.error("Add treasury ETH failed:", error);
        setError("Failed to add ETH to treasury");
        throw error;
      } finally {
        setIsLoading(false);
      }
    },

    // Utils
    clearError: () => setError(null),
  };
}
