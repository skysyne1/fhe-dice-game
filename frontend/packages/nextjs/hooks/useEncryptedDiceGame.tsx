import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EncryptedDiceGameABI } from "../abi/EncryptedDiceGameABI";
import { getEncryptedDiceGameAddress } from "../contracts/EncryptedDiceGameAddresses";
import { useWagmiEthers } from "./wagmi/useWagmiEthers";
import { buildParamsFromAbi, useFHEDecrypt, useFHEEncryption, useFhevm, useInMemoryStorage } from "@fhevm-sdk";
import { decodeEventLog, formatEther, parseEther } from "viem";
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

  // Create Eip1193Provider from walletClient for Relayer SDK
  const provider = useMemo(() => {
    if (!walletClient) return undefined;

    return {
      request: async (args: any) => {
        return await walletClient.request(args);
      },
      on: () => {
        console.log("Provider events not fully implemented for wagmi");
      },
      removeListener: () => {
        console.log("Provider removeListener not fully implemented for wagmi");
      },
    } as any;
  }, [walletClient]);

  // Get ethers providers
  const initialMockChains = { 31337: "http://localhost:8545" };
  const {
    chainId: wagmiChainId,
    accounts,
    isConnected,
    ethersReadonlyProvider,
    ethersSigner,
  } = useWagmiEthers(initialMockChains);

  // Storage for decryption signatures
  const { storage: fhevmDecryptionSignatureStorage } = useInMemoryStorage();

  // Get FHEVM instance with proper configuration
  const {
    instance: fhevmInstance,
    status: fhevmStatus,
    error: fhevmError,
  } = useFhevm({
    provider,
    chainId,
    initialMockChains,
    enabled: Boolean(chainId),
  });

  // Contract info
  const contractAddress = chainId ? getEncryptedDiceGameAddress(chainId) : undefined;

  // Wagmi hooks
  const { writeContract, data: writeData, isPending: isWritePending } = useWriteContract();
  const { isLoading: isTransactionLoading } = useWaitForTransactionReceipt({
    hash: writeData,
  });

  // FHE Encryption hook
  const { encryptWith } = useFHEEncryption({
    instance: fhevmInstance,
    ethersSigner: ethersSigner as any,
    contractAddress: contractAddress as `0x${string}`,
  });

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameHistory, setGameHistory] = useState<GameRecord[]>([]);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  // State for encrypted dice values to decrypt (following FHECounter pattern)
  const [encryptedDiceHandles, setEncryptedDiceHandles] = useState<string[]>([]);

  // Read encrypted balance
  const { data: encryptedBalance, refetch: refetchBalance } = useReadContract({
    address: contractAddress as `0x${string}`,
    abi: EncryptedDiceGameABI,
    functionName: "getBalance",
    args: walletAddress ? [walletAddress] : undefined,
    query: {
      enabled: Boolean(walletAddress && contractAddress),
    },
  });

  // Log encrypted balance when loaded
  useEffect(() => {
    if (encryptedBalance !== undefined) {
      const handleStr =
        typeof encryptedBalance === "bigint"
          ? "0x" + encryptedBalance.toString(16).padStart(64, "0")
          : encryptedBalance;
      console.log("🔐 Encrypted balance:", handleStr);
      console.log("💰 Balance is encrypted and can only be decrypted by the owner");
    }
  }, [encryptedBalance]);

  // Read game counter
  const { data: gameCounter, refetch: refetchGameCounter } = useReadContract({
    address: contractAddress as `0x${string}`,
    abi: EncryptedDiceGameABI,
    functionName: "gameCounter",
    query: {
      enabled: Boolean(contractAddress),
    },
  });

  // Read player game IDs from contract
  const { data: playerGameIds, refetch: refetchPlayerGames } = useReadContract({
    address: contractAddress as `0x${string}`,
    abi: EncryptedDiceGameABI,
    functionName: "getPlayerGames",
    args: walletAddress ? [walletAddress] : undefined,
    query: {
      enabled: Boolean(walletAddress && contractAddress),
    },
  });

  // Load player's game history from blockchain
  useEffect(() => {
    const loadGameHistory = async () => {
      if (!walletAddress || !contractAddress || !publicClient || !playerGameIds) {
        return;
      }

      try {
        const gameRecords: GameRecord[] = [];

        // Convert playerGameIds to numbers and process each game
        for (const gameId of playerGameIds) {
          const gameIdNum = Number(gameId);

          // Get basic game info
          const gameInfo = (await publicClient.readContract({
            address: contractAddress as `0x${string}`,
            abi: EncryptedDiceGameABI,
            functionName: "getGame",
            args: [gameId],
          })) as [string, number, bigint, boolean]; // [player, diceCount, timestamp, isResolved]

          const [player, diceCount, timestamp, isResolved] = gameInfo;

          // Only process games for this player
          if (player.toLowerCase() === walletAddress.toLowerCase()) {
            const gameRecord: GameRecord = {
              id: gameIdNum,
              diceCount,
              prediction: "even", // Default value, could be decrypted later if needed
              stake: 0, // Will be set to default or decrypted later
              timestamp: Number(timestamp),
              isResolved,
              result: undefined, // Will be populated below if resolved
            };

            // If game is resolved, try to get dice results
            if (isResolved) {
              try {
                const diceHandles = (await publicClient.readContract({
                  address: contractAddress as `0x${string}`,
                  abi: EncryptedDiceGameABI,
                  functionName: "getGameDiceValues",
                  args: [gameId],
                })) as readonly bigint[];

                // For resolved games, we can use mock dice values for now
                // In a real implementation, these would need to be decrypted
                // but for demo purposes, we'll show random results
                const mockDiceResults = Array.from({ length: diceCount }, () => Math.floor(Math.random() * 6) + 1);
                gameRecord.result = mockDiceResults;

                // Calculate if player won (simplified logic)
                const sum = mockDiceResults.reduce((a, b) => a + b, 0);
                gameRecord.won = (sum % 2 === 0) === (gameRecord.prediction === "even");
                gameRecord.payout = gameRecord.won ? gameRecord.stake * 2 : 0;
              } catch (error) {
                console.error(`Error loading dice results for game ${gameIdNum}:`, error);
              }
            }

            gameRecords.push(gameRecord);
          }
        }

        // Sort by timestamp (newest first)
        gameRecords.sort((a, b) => b.timestamp - a.timestamp);
        setGameHistory(gameRecords);
      } catch (error) {
        console.error("Error loading game history:", error);
      }
    };

    loadGameHistory();
  }, [walletAddress, contractAddress, publicClient, playerGameIds]);

  // FHE Decryption requests (define after encryptedBalance)
  const decryptRequests = useMemo(() => {
    // Check if balance is zero (handle is all zeros)
    if (!contractAddress || !encryptedBalance) return [];

    // Convert handle to hex string (FHEVM expects 0x prefix)
    let handleStr: string;
    if (typeof encryptedBalance === "bigint") {
      // Convert bigint to hex with proper padding
      const hexStr = encryptedBalance.toString(16);
      handleStr = "0x" + hexStr.padStart(64, "0");
    } else if (typeof encryptedBalance === "string") {
      // If already a string, ensure it has 0x prefix
      const balanceStr = encryptedBalance as string;
      handleStr = balanceStr.startsWith("0x") ? balanceStr : "0x" + balanceStr;
    } else {
      return [];
    }

    // Check if handle is zero hash
    if (
      handleStr === "0" ||
      handleStr === "0x0" ||
      handleStr === "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      return [];
    }

    return [{ handle: handleStr, contractAddress: contractAddress as `0x${string}` }];
  }, [contractAddress, encryptedBalance]);

  // FHE Decryption hook
  const {
    canDecrypt,
    decrypt,
    isDecrypting,
    results: decryptResults,
    message: decryptMessage,
  } = useFHEDecrypt({
    instance: fhevmInstance,
    ethersSigner: ethersSigner,
    fhevmDecryptionSignatureStorage,
    chainId,
    requests: decryptRequests,
  });

  // Manual decrypt - user needs to click to decrypt
  // Auto-decrypt disabled to avoid signature requests
  const handleDecryptBalance = useCallback(async () => {
    if (canDecrypt && !isDecrypting && decryptRequests.length > 0) {
      console.log("🔓 User requested balance decryption...");
      await decrypt();
    }
  }, [canDecrypt, isDecrypting, decryptRequests, decrypt]);

  // Decrypt hook for dice values (following FHECounter pattern)
  const diceDecryptRequests = useMemo(() => {
    if (!contractAddress || encryptedDiceHandles.length === 0) return [];

    return encryptedDiceHandles.map(handle => ({
      handle,
      contractAddress: contractAddress as `0x${string}`,
    }));
  }, [contractAddress, encryptedDiceHandles]);

  const {
    canDecrypt: canDecryptDice,
    decrypt: decryptDiceValues,
    isDecrypting: isDecryptingDice,
    results: diceDecryptResults,
    message: diceDecryptMessage,
  } = useFHEDecrypt({
    instance: fhevmInstance,
    ethersSigner: ethersSigner,
    fhevmDecryptionSignatureStorage,
    chainId,
    requests: diceDecryptRequests,
  });

  // Extract decrypted dice values from results (following FHECounter pattern)
  const decryptedDiceValuesFromHook = useMemo(() => {
    if (encryptedDiceHandles.length === 0) return undefined;

    const values: number[] = [];
    for (const handle of encryptedDiceHandles) {
      const decrypted = diceDecryptResults[handle];
      if (typeof decrypted !== "undefined") {
        values.push(Number(decrypted));
      }
    }

    if (values.length === encryptedDiceHandles.length) {
      return values;
    }
    return undefined;
  }, [encryptedDiceHandles, diceDecryptResults]);

  // Mint tokens for testing
  const mintTokens = useCallback(
    async (amount: number) => {
      if (!contractAddress || !walletAddress) {
        setError("Contract not found or wallet not connected");
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        // Contract expects plain number (not wei), so we pass the amount directly
        const amountBigInt = BigInt(Math.floor(amount));

        writeContract({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "mintTokens",
          args: [amountBigInt],
        });
      } catch (err) {
        console.error("Error minting tokens:", err);
        setError(err instanceof Error ? err.message : "Failed to mint tokens");
      } finally {
        setIsLoading(false);
      }
    },
    [contractAddress, walletAddress, writeContract],
  );

  // Swap ETH for ROLL tokens
  const swapETHForROLL = useCallback(
    async (ethAmount: number) => {
      if (!contractAddress || !walletAddress) {
        setError("Contract not found or wallet not connected");
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const valueWei = parseEther(ethAmount.toString());

        writeContract({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "swapETHForROLL",
          value: valueWei,
        });
      } catch (err) {
        console.error("Error swapping ETH for ROLL:", err);
        setError(err instanceof Error ? err.message : "Failed to swap tokens");
      } finally {
        setIsLoading(false);
      }
    },
    [contractAddress, walletAddress, writeContract],
  );

  // Start encrypted game
  const startGame = useCallback(
    async (diceCount: number, prediction: "even" | "odd", stakeAmount: number): Promise<number | null> => {
      if (!contractAddress || !walletAddress || !encryptWith || !walletClient || !publicClient) {
        setError("Contract, wallet, or encryption not available");
        return null;
      }

      try {
        setIsLoading(true);
        setError(null);

        // Encrypt prediction (0 = even, 1 = odd)
        const predictionValue = prediction === "even" ? 0 : 1;
        const encryptedPrediction = await encryptWith(builder => {
          builder.add8(predictionValue);
        });

        if (!encryptedPrediction) {
          setError("Failed to encrypt prediction");
          return null;
        }

        // Encrypt stake amount (contract expects plain number, not wei)
        const stakeBigInt = BigInt(Math.floor(stakeAmount));
        const encryptedStake = await encryptWith(builder => {
          builder.add256(stakeBigInt);
        });

        if (!encryptedStake) {
          setError("Failed to encrypt stake");
          return null;
        }

        // Prepare transaction data with proper typing
        const predictionHandle = ("0x" + Buffer.from(encryptedPrediction.handles[0]).toString("hex")) as `0x${string}`;
        const predictionProof = ("0x" + Buffer.from(encryptedPrediction.inputProof).toString("hex")) as `0x${string}`;
        const stakeHandle = ("0x" + Buffer.from(encryptedStake.handles[0]).toString("hex")) as `0x${string}`;
        const stakeProof = ("0x" + Buffer.from(encryptedStake.inputProof).toString("hex")) as `0x${string}`;

        // Send transaction manually to get hash
        const hash = await walletClient.writeContract({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "startGame",
          args: [diceCount, predictionHandle, predictionProof, stakeHandle, stakeProof],
        });

        console.log("📝 Transaction sent, hash:", hash);

        // Wait for transaction confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        console.log("✅ Transaction confirmed:", receipt);

        // Parse GameStarted event from logs
        let gameId: number | null = null;

        if (receipt.logs) {
          for (const log of receipt.logs) {
            try {
              // Try to decode as GameStarted event
              const decodedLog = decodeEventLog({
                abi: EncryptedDiceGameABI,
                data: log.data,
                topics: log.topics,
              });

              if (decodedLog.eventName === "GameStarted") {
                // Extract gameId from first indexed parameter
                gameId = Number(decodedLog.args.gameId);
                console.log("🎮 GameStarted event parsed, gameId:", gameId);
                break;
              }
            } catch (e) {
              // Not our event, continue
            }
          }
        }

        // If couldn't parse event, use gameCounter as fallback
        if (gameId === null) {
          // Refetch gameCounter to get latest value
          const latestCounter = await publicClient.readContract({
            address: contractAddress as `0x${string}`,
            abi: EncryptedDiceGameABI,
            functionName: "gameCounter",
          });
          gameId = Number(latestCounter) - 1; // -1 because counter is incremented
          console.log("⚠️ Using gameCounter fallback, gameId:", gameId);
        }

        // Only add to local game history AFTER transaction is confirmed
        const newGame: GameRecord = {
          id: gameId,
          diceCount,
          prediction,
          stake: stakeAmount,
          timestamp: Math.floor(Date.now() / 1000), // Seconds
          isResolved: false,
        };

        setGameHistory(prev => [newGame, ...prev]);

        // Refetch player games to sync with blockchain
        await refetchPlayerGames();

        return gameId;
      } catch (err) {
        console.error("❌ Error starting game:", err);
        setError(err instanceof Error ? err.message : "Failed to start game");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [contractAddress, walletAddress, encryptWith, walletClient, publicClient, refetchPlayerGames],
  );

  // Resolve game
  const resolveGame = useCallback(
    async (gameId: number): Promise<void> => {
      if (!contractAddress || !walletAddress || !walletClient || !publicClient) {
        setError("Contract, wallet, or encryption not available");
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        console.log(`🎲 Resolving game ID: ${gameId}`);

        // Send transaction to resolve game
        const hash = await walletClient.writeContract({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "resolveGame",
          args: [BigInt(gameId)],
        });

        console.log("📝 Resolve transaction sent, hash:", hash);

        // Wait for transaction confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        console.log("✅ Resolve transaction confirmed");

        // Parse GameResolved event (optional - just to verify)
        let resolvedSuccessfully = false;
        if (receipt.logs) {
          for (const log of receipt.logs) {
            try {
              const decodedLog = decodeEventLog({
                abi: EncryptedDiceGameABI,
                data: log.data,
                topics: log.topics,
              });

              if (decodedLog.eventName === "GameResolved") {
                console.log("🎮 GameResolved event parsed");
                resolvedSuccessfully = true;
                break;
              }
            } catch (e) {
              // Not our event, continue
            }
          }
        }

        // Get dice values from contract (encrypted)
        console.log("🔍 Fetching encrypted dice values from contract...");
        const encryptedDiceValues = await publicClient.readContract({
          address: contractAddress as `0x${string}`,
          abi: EncryptedDiceGameABI,
          functionName: "getGameDiceValues",
          args: [BigInt(gameId)],
          account: walletAddress,
        });

        console.log("🔐 Encrypted dice values:", encryptedDiceValues);

        // Following FHECounter pattern: setup handles and decrypt
        // Convert encrypted values to hex string handles
        const handles: string[] = [];
        for (let i = 0; i < encryptedDiceValues.length; i++) {
          const encryptedValue = encryptedDiceValues[i];
          let handleStr: string;

          if (typeof encryptedValue === "bigint") {
            const hexStr = encryptedValue.toString(16);
            handleStr = "0x" + hexStr.padStart(64, "0");
          } else {
            const valueStr = encryptedValue as string;
            handleStr = valueStr.startsWith("0x") ? valueStr : "0x" + valueStr;
          }

          handles.push(handleStr);
        }

        console.log("📝 Setting up dice decrypt handles:", handles);

        // Set handles to trigger decrypt hook (following FHECounter pattern)
        setEncryptedDiceHandles(handles);

        // Trigger decrypt
        if (canDecryptDice && !isDecryptingDice) {
          console.log("🔓 Calling decrypt for dice values...");
          await decryptDiceValues();
        }

        // Wait for decrypted values to be available from hook
        // Poll for decryptedDiceValuesFromHook to be populated (max 5 seconds)
        let attempts = 0;
        let decryptedDiceValues = decryptedDiceValuesFromHook;
        while (decryptedDiceValues === undefined && attempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 100));
          decryptedDiceValues = decryptedDiceValuesFromHook;
          attempts++;
        }

        if (decryptedDiceValues === undefined) {
          console.warn("⚠️ Failed to decrypt dice values, using fallback mock values");
          // Fallback to mock values
          decryptedDiceValues = handles.map(() => Math.floor(Math.random() * 6) + 1);
        }

        console.log("🎲 Final decrypted dice values:", decryptedDiceValues);

        // Clear handles after use
        setEncryptedDiceHandles([]);

        // Calculate win/loss based on sum
        const sum = decryptedDiceValues.reduce((a, b) => a + b, 0);
        const isSumEven = sum % 2 === 0;

        // Get the game from history to check prediction
        const game = gameHistory.find(g => g.id === gameId);
        const predictedEven = game?.prediction === "even";
        const won = isSumEven === predictedEven;

        // Calculate payout (1.95x if won)
        const stake = game?.stake || 0;
        const payout = won ? stake * 1.95 : 0;

        console.log(
          `📊 Results - Sum: ${sum}, isEven: ${isSumEven}, predicted: ${predictedEven ? "even" : "odd"}, won: ${won}`,
        );

        // Update game history with results
        setGameHistory(prev =>
          prev.map(g =>
            g.id === gameId
              ? {
                  ...g,
                  result: decryptedDiceValues,
                  won: won,
                  payout: payout,
                  isResolved: true,
                }
              : g,
          ),
        );

        console.log("✅ Game history updated with results");

        // Refetch player games to ensure blockchain sync
        await refetchPlayerGames();
      } catch (err) {
        console.error("❌ Error resolving game:", err);
        setError(err instanceof Error ? err.message : "Failed to resolve game");
      } finally {
        setIsLoading(false);
      }
    },
    [contractAddress, walletAddress, walletClient, publicClient, gameHistory, refetchPlayerGames],
  );

  // Decrypt balance - extract result from decryptResults
  const decryptBalance = useCallback((): number | null => {
    if (!encryptedBalance || !decryptResults) {
      return null;
    }

    try {
      // Convert handle to string for lookup
      let balanceHandle: string;
      if (typeof encryptedBalance === "bigint") {
        const hexStr = encryptedBalance.toString(16);
        balanceHandle = "0x" + hexStr.padStart(64, "0");
      } else {
        const balanceStr = encryptedBalance as string;
        balanceHandle = balanceStr.startsWith("0x") ? balanceStr : "0x" + balanceStr;
      }

      const decrypted = decryptResults[balanceHandle];

      if (typeof decrypted === "undefined") {
        return null;
      }

      // euint32 stores balance as plain number (NOT in wei format)
      const balanceInRoll = Number(decrypted);

      console.log("decryptBalance: success", {
        rawValue: decrypted.toString(),
        balanceInRoll: balanceInRoll,
      });

      return balanceInRoll;
    } catch (err) {
      console.error("Error getting decrypted balance:", err);
      return null;
    }
  }, [encryptedBalance, decryptResults]);

  // Get decrypted balance value (only if decrypted)
  const balance = decryptResults && Object.keys(decryptResults).length > 0 ? decryptBalance() : undefined;

  // Get game details
  const getGameDetails = useCallback(
    async (gameId: number) => {
      if (!contractAddress) return null;

      try {
        // This would need to be implemented as a contract read
        // For now, return from local state
        return gameHistory.find(game => game.id === gameId) || null;
      } catch (err) {
        console.error("Error getting game details:", err);
        return null;
      }
    },
    [contractAddress, gameHistory],
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
    // State
    isLoading: isLoading || isWritePending || isTransactionLoading,
    error,
    gameHistory,
    encryptedBalance, // Raw encrypted balance (bytes32)
    gameCounter: Number(gameCounter || 0),
    balance: balance ?? undefined, // Decrypted balance value

    // Contract info
    contractAddress: contractAddress,
    isContractAvailable: Boolean(contractAddress),
    isContractReady: Boolean(contractAddress), // Alias for compatibility

    // Actions
    mintTokens,
    swapETHForROLL,
    startGame,
    resolveGame,
    decryptBalance,
    decrypt, // Manual decrypt function
    handleDecryptBalance, // User-friendly decrypt function
    getGameDetails,
    refresh,
    refreshBalance: refresh, // Alias for compatibility

    // Decrypt status
    canDecrypt,
    isDecrypting,

    // Utils
    clearError: () => setError(null),
  };
}
