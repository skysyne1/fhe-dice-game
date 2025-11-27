"use client";

import { useCallback, useEffect, useState } from "react";
import { EncryptedDiceGameABI } from "../abi/EncryptedDiceGameABI";
import { getEncryptedDiceGameAddress } from "../abi/EncryptedDiceGameAddresses";
import { useDecryptedBalance } from "../contexts/DecryptedBalanceContext";
import { ethers } from "ethers";
import { initializeFheInstance, useContract, useEncrypt } from "fhevm-sdk";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWalletClient,
  useWriteContract,
} from "wagmi";

export type GameRecord = {
  id: number;
  diceCount: number;
  prediction: "even" | "odd";
  stake: number;
  result?: number[];
  won?: boolean;
  payout?: number;
  timestamp: number;
  isResolved: boolean;
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
  useEffect(() => {
    const initFhevm = async () => {
      try {
        setFhevmStatus("loading");
        await initializeFheInstance();
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
  }, []);

  // Contract info
  const contractAddress = chainId ? getEncryptedDiceGameAddress(chainId) : undefined;

  // Auto-clear cache when contract address changes
  const { clearCache } = useDecryptedBalance();

  useEffect(() => {
    const STORAGE_KEY = "fhe-dice-contract-address";

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
  const { contract: readContract } = useContract(contractAddress || "", EncryptedDiceGameABI);

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameHistory, setGameHistory] = useState<GameRecord[]>([]);
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
      return (`0x${hex}`) as `0x${string}`;
    }

    // Fallback: try toString and wrap
    const str = String(value);
    return (`0x${str.replace(/^0x/, "")}`) as `0x${string}`;
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

  // Read game counter
  const { data: gameCounter, refetch: refetchGameCounter } = useReadContract({
    address: contractAddress as `0x${string}`,
    abi: EncryptedDiceGameABI,
    functionName: "gameCounter",
    query: {
      enabled: Boolean(contractAddress),
    },
  });

  // Read player game IDs
  const { data: playerGameIds, refetch: refetchPlayerGames } = useReadContract({
    address: contractAddress as `0x${string}`,
    abi: EncryptedDiceGameABI,
    functionName: "getPlayerGames",
    args: walletAddress ? [walletAddress] : undefined,
    query: {
      enabled: Boolean(walletAddress && contractAddress),
    },
  });

  // Load game history from blockchain
  useEffect(() => {
    const loadGameHistory = async () => {
      if (!walletAddress || !contractAddress || !publicClient || !playerGameIds) return;

      try {
        const gameIds = playerGameIds as bigint[];
        const games: GameRecord[] = [];

        for (const gameId of gameIds) {
          const gameData = await publicClient.readContract({
            address: contractAddress as `0x${string}`,
            abi: EncryptedDiceGameABI,
            functionName: "getGame",
            args: [gameId],
          });

          if (gameData) {
            const gameDataArray = gameData as unknown as any[];
            const [player, diceCount, prediction, stake, timestamp, isResolved] = gameDataArray;

            games.push({
              id: Number(gameId),
              diceCount: Number(diceCount),
              prediction: Number(prediction) === 0 ? "even" : "odd",
              stake: Number(stake),
              timestamp: Number(timestamp),
              isResolved: Boolean(isResolved),
            });
          }
        }

        setGameHistory(games.sort((a, b) => b.timestamp - a.timestamp));
      } catch (error) {
        console.error("Failed to load game history:", error);
      }
    };

    loadGameHistory();
  }, [walletAddress, contractAddress, publicClient, playerGameIds]);

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

  // Start encrypted game using FHEVM 0.9 pattern
  const startGame = useCallback(
    async (diceCount: number, prediction: "even" | "odd", stakeAmount: number): Promise<number | null> => {
      if (!contractAddress || !walletAddress || !walletClient || !isInitialized) {
        return null;
      }

      try {
        setIsLoading(true);
        setError(null);

        console.log("🎲 Starting encrypted game...");

        // Encrypt prediction (0 = even, 1 = odd) using new SDK
        const predictionValue = prediction === "even" ? 0 : 1;
        const encryptedPrediction = await encrypt(contractAddress, walletAddress, predictionValue);

        // Encrypt stake amount using new SDK
        const encryptedStake = await encrypt(contractAddress, walletAddress, stakeAmount);

        console.log("✅ Encryption completed, submitting transaction...");

        // Submit game transaction
        const txHash = await writeContractAsync({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "startGame",
          args: [
            diceCount,
            toHexString(encryptedPrediction.encryptedData),
            toHexString(encryptedPrediction.proof),
            toHexString(encryptedStake.encryptedData),
            toHexString(encryptedStake.proof),
          ],
        });

        console.log("✅ Start game transaction submitted!", txHash);

        return gameCounter ? Number(gameCounter) + 1 : 1;
      } catch (error) {
        console.error("Start game failed:", error);
        setError(encryptError || "Failed to start game");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [contractAddress, walletAddress, walletClient, isInitialized, encrypt, encryptError, writeContractAsync, gameCounter],
  );

  // Resolve game using FHEVM 0.9 self-relaying pattern
  const resolveGame = useCallback(
    async (gameId: number): Promise<void> => {
      if (!contractAddress || !walletAddress || !walletClient) return;

      try {
        setIsLoading(true);
        setError(null);

        console.log("🎲 Resolving game with FHEVM 0.9 self-relaying...");

        // Step 1: Call resolveGame to generate encrypted dice values
        const txHash = await writeContractAsync({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "resolveGame",
          args: [BigInt(gameId)],
        });

        // Note: In a full implementation, you would need to:
        // 1. Get encrypted dice handles from the contract
        // 2. Make them publicly decryptable
        // 3. Use publicDecrypt to get cleartext values
        // 4. Submit cleartext values back with verification signatures

        console.log("✅ Game resolution transaction submitted!", txHash);
      } catch (error) {
        console.error("Resolve game failed:", error);
        setError("Failed to resolve game");
      } finally {
        setIsLoading(false);
      }
    },
    [contractAddress, walletAddress, walletClient, writeContractAsync],
  );

  // Refresh data
  const refresh = useCallback(async () => {
    await Promise.all([refetchBalance(), refetchGameCounter(), refetchPlayerGames()]);
  }, [refetchBalance, refetchGameCounter, refetchPlayerGames]);

  // Auto-refresh on transaction completion
  useEffect(() => {
    if (writeData && !isTransactionLoading) {
      refresh();
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

    // Game data
    gameHistory,
    gameCounter: Number(gameCounter || 0),

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
    startGame,
    resolveGame,
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
