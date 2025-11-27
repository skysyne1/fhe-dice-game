import { useState } from "react";
import { useDecryptedBalance } from "../../contexts/DecryptedBalanceContext";
import { LoadingOverlay } from "../LoadingOverlay";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { SwapNotice } from "./SwapNotice";
import { ArrowDownUp, Coins } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useBalance } from "wagmi";

interface TokenSwapProps {
  balance: number;
  isContractReady: boolean;
  isContractLoading: boolean;
  contractError: string | null;
  isTransactionPending?: boolean;
  isTransactionLoading?: boolean;
  onMintTokens: () => void;
  onSwapETHForROLL: (amount: number) => Promise<void>;
  onSwapROLLForETH: (amount: number) => Promise<void>;
  onRefresh: () => Promise<void>;
  onClearError: () => void;
  onShowOverlay?: (message: string, description?: string, showDice?: boolean) => void;
  onHideOverlay?: () => void;
}

export function TokenSwap({
  balance,
  isContractReady,
  isContractLoading,
  contractError,
  isTransactionPending = false,
  isTransactionLoading = false,
  onMintTokens,
  onSwapETHForROLL,
  onSwapROLLForETH,
  onRefresh,
  onClearError,
  onShowOverlay,
  onHideOverlay,
}: TokenSwapProps) {
  const { address } = useAccount();
  const { data: ethBalanceData } = useBalance({ address });
  const { decryptedRollBalance } = useDecryptedBalance();

  // Swap direction: 'ETH_TO_ROLL' or 'ROLL_TO_ETH'
  const [swapDirection, setSwapDirection] = useState<"ETH_TO_ROLL" | "ROLL_TO_ETH">("ETH_TO_ROLL");
  const [swapAmount, setSwapAmount] = useState("");
  const [isSwapping, setIsSwapping] = useState(false);

  // LoadingOverlay should only show when transaction is submitted and waiting for confirmation
  const showLoadingOverlay = isTransactionLoading;

  const exchangeRate = 1000; // 1 ETH = 1000 ROLL
  const ethBalance = ethBalanceData ? parseFloat(ethBalanceData.formatted) : 0;
  const rollBalance = decryptedRollBalance !== undefined ? decryptedRollBalance : balance;

  // Calculate output amount based on swap direction
  const toAmount = swapAmount
    ? swapDirection === "ETH_TO_ROLL"
      ? (parseFloat(swapAmount) * exchangeRate).toFixed(0)
      : (parseFloat(swapAmount) / exchangeRate).toFixed(3)
    : "";

  // Check if user has decrypted ROLL balance for enabling swap
  const isDecryptReady = decryptedRollBalance !== undefined;

  // Swap validation constants
  const minETHRequired = 0.001; // Minimum ETH to get at least 1 ROLL
  const maxETHAllowed = 4294; // Max ETH to avoid uint32 overflow (~4.3M ROLL)
  const minROLLRequired = 1; // Minimum ROLL to swap
  const maxROLLAllowed = 4294967295; // Max ROLL (uint32)

  // Allow free typing, limit to available balance
  const handleAmountChange = (value: string) => {
    const numValue = parseFloat(value);

    if (swapDirection === "ETH_TO_ROLL") {
      // ETH → ROLL: limit to ETH balance
      if (!isNaN(numValue) && numValue > ethBalance) {
        setSwapAmount(ethBalance.toString());
      } else {
        setSwapAmount(value);
      }
    } else {
      // ROLL → ETH: limit to ROLL balance
      if (!isNaN(numValue) && numValue > rollBalance) {
        setSwapAmount(rollBalance.toString());
      } else {
        setSwapAmount(value);
      }
    }
  };

  // Round amounts when user finishes typing
  const handleAmountBlur = () => {
    const numValue = parseFloat(swapAmount);
    if (!isNaN(numValue) && numValue > 0) {
      if (swapDirection === "ETH_TO_ROLL") {
        // ETH → ROLL: Round up to nearest 0.001 ETH (1 ROLL)
        const roundedValue = Math.ceil(numValue / 0.001) * 0.001;
        const finalValue = roundedValue > ethBalance ? ethBalance : roundedValue;
        setSwapAmount(finalValue.toFixed(3));
      } else {
        // ROLL → ETH: Round up to nearest whole ROLL and limit to balance
        let roundedValue = Math.ceil(numValue);
        if (roundedValue < minROLLRequired) roundedValue = minROLLRequired;
        const finalValue = roundedValue > rollBalance ? rollBalance : roundedValue;
        setSwapAmount(finalValue.toString());
      }
    }
  };

  const handleSwap = async () => {
    const amount = parseFloat(swapAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    // Validation based on swap direction
    if (swapDirection === "ETH_TO_ROLL") {
      if (amount > maxETHAllowed) {
        toast.error(`Maximum ${maxETHAllowed.toLocaleString()} ETH per transaction to avoid overflow`);
        return;
      }
    } else {
      if (amount > maxROLLAllowed) {
        toast.error(`Maximum ${maxROLLAllowed.toLocaleString()} ROLL per transaction to avoid overflow`);
        return;
      }
    }

    if (!isContractReady) {
      toast.error("Smart contract not ready. Please check your network connection.");
      return;
    }

    // Show loading overlay and disable button
    setIsSwapping(true);

    if (swapDirection === "ETH_TO_ROLL") {
      onShowOverlay?.("Swapping Tokens...", "Confirm transaction in MetaMask", false);
    } else {
      onShowOverlay?.("Swapping Tokens...", `Swapping ${amount} ROLL for ETH. Confirm in MetaMask`, false);
    }

    try {
      // Call the appropriate swap function based on direction
      if (swapDirection === "ETH_TO_ROLL") {
        await onSwapETHForROLL(amount);
        toast.success(`Swapped ${amount} ETH for ${amount * exchangeRate} ROLL`, {
          description: "Transaction confirmed on blockchain",
        });
      } else {
        await onSwapROLLForETH(amount);
        const ethReceived = amount / exchangeRate;
        toast.success(`Swapped ${amount} ROLL for ${ethReceived.toFixed(3)} ETH`, {
          description: "Transaction confirmed on blockchain",
        });
      }

      // Refresh balance
      await onRefresh();
      setSwapAmount("");
    } catch (error: any) {
      console.error("Swap error:", error);

      // Check if user rejected the transaction
      if (error?.code === 4001 || error?.message?.includes("User denied") || error?.message?.includes("rejected")) {
        toast.error("Transaction cancelled", {
          description: "You cancelled the transaction in MetaMask",
        });
      } else {
        toast.error("Swap failed", {
          description: error?.message || "Please try again",
        });
      }
    } finally {
      setIsSwapping(false);
      onHideOverlay?.();
    }
  };
  const handleMaxAmount = () => {
    if (swapDirection === "ETH_TO_ROLL") {
      setSwapAmount(ethBalance.toString());
    } else {
      setSwapAmount(rollBalance.toString());
    }
  };

  const handleSwapDirection = () => {
    setSwapDirection(prev => (prev === "ETH_TO_ROLL" ? "ROLL_TO_ETH" : "ETH_TO_ROLL"));
    setSwapAmount(""); // Clear input when switching
  };

  return (
    <div className="flex-[3]">
      <Card className="bg-gradient-to-br from-[#2a2a2a]/60 to-[#1a1a1a]/40 backdrop-blur-sm border-2 border-[#fde047]/30 p-6 shadow-2xl shadow-[#fde047]/10 lg:sticky lg:top-24">
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-4">
            <ArrowDownUp className="h-5 w-5 text-[#fde047] drop-shadow-[0_0_6px_rgba(253,224,71,0.4)]" />
            <h3 className="font-semibold text-[#fde047]">Token Swap</h3>
          </div>

          {/* Balance & Testing Controls */}
          <div className="space-y-3">
            {/* General Info: depends on swap direction */}
            <div
              className="text-sm text-center bg-gradient-to-r from-[#fde047] via-[#fef3c7] to-[#fed7aa] bg-clip-text text-transparent drop-shadow-sm font-semibold mb-2"
              style={{ letterSpacing: "0.01em" }}
            >
              {swapDirection === "ETH_TO_ROLL"
                ? "You will always receive a whole number of ROLL tokens. ETH amount will be rounded up to the nearest 0.001 before swapping."
                : "ROLL amount will be rounded to the nearest whole number before swapping."}
            </div>
          </div>

          {/* Contract Status */}
          {!isContractReady && (
            <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
              <p className="text-sm text-orange-400">⚠️ Smart contract not ready - Check network connection</p>
            </div>
          )}

          {contractError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400">❌ {contractError}</p>
              <Button onClick={onClearError} size="sm" variant="outline" className="mt-2 text-xs">
                Clear Error
              </Button>
            </div>
          )}

          {/* FROM Token - changes based on swap direction */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-[#d4d4d4]">From</label>
              <span className="text-sm text-[#a3a3a3]">
                Balance:{" "}
                {swapDirection === "ETH_TO_ROLL"
                  ? `${ethBalance.toFixed(4)} ETH`
                  : `${rollBalance.toLocaleString()} ROLL`}
              </span>
            </div>
            <div className="relative">
              <Input
                type="number"
                value={swapAmount}
                onChange={e => handleAmountChange(e.target.value)}
                onBlur={handleAmountBlur}
                className="h-14 text-xl pr-24 bg-[#2a2a2a] border-[#404040] focus:border-[#fde047] text-[#ffffff] placeholder:text-[#a3a3a3]"
                placeholder={isDecryptReady ? "0.0" : "Decrypt your ROLL balance to enable swapping"}
                disabled={isSwapping || !isDecryptReady}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-[#404040] px-3 py-2 rounded-lg">
                {swapDirection === "ETH_TO_ROLL" ? (
                  <>
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z"
                        fill="currentColor"
                        className="text-[#fde047]"
                      />
                    </svg>
                    <span className="font-semibold text-[#ffffff]">ETH</span>
                  </>
                ) : (
                  <>
                    <Coins className="h-5 w-5 text-[#fde047]" />
                    <span className="font-semibold text-[#ffffff]">ROLL</span>
                  </>
                )}
              </div>
            </div>
            <button
              onClick={handleMaxAmount}
              className="text-xs px-2 py-1 rounded bg-[#fde047]/20 text-[#fde047] hover:bg-[#fde047]/30 transition-colors border border-[#fde047]/30"
              disabled={!isDecryptReady}
            >
              Max
            </button>
          </div>

          {/* Swap Arrow - Click to toggle direction */}
          <div className="flex justify-center">
            <button
              onClick={handleSwapDirection}
              className="p-2 rounded-full bg-[#404040] border-2 border-[#404040] hover:bg-[#fde047]/20 hover:border-[#fde047]/50 transition-all hover:rotate-180 duration-300 cursor-pointer"
            >
              <ArrowDownUp className="h-6 w-6 text-[#fde047]" />
            </button>
          </div>

          {/* TO Token - changes based on swap direction */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm text-[#d4d4d4]">To</label>
              <span className="text-sm text-[#a3a3a3]">
                Rate:{" "}
                {swapDirection === "ETH_TO_ROLL"
                  ? `1 ETH = ${exchangeRate} ROLL`
                  : `1 ROLL = ${(1 / exchangeRate).toFixed(3)} ETH`}
              </span>
            </div>
            <div className="relative">
              <Input
                type="text"
                value={toAmount}
                className="h-14 text-xl pr-24 bg-[#2a2a2a] border-[#404040] text-[#ffffff]"
                placeholder="0.0"
                disabled
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-[#404040] px-3 py-2 rounded-lg">
                {swapDirection === "ETH_TO_ROLL" ? (
                  <>
                    <Coins className="h-5 w-5 text-[#fde047]" />
                    <span className="font-semibold text-[#ffffff]">ROLL</span>
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z"
                        fill="currentColor"
                        className="text-[#fde047]"
                      />
                    </svg>
                    <span className="font-semibold text-[#ffffff]">ETH</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Swap Notice */}
          <SwapNotice
            isDecryptReady={isDecryptReady}
            swapAmount={swapAmount}
            swapDirection={swapDirection}
            minETHRequired={minETHRequired}
            maxETHAllowed={maxETHAllowed}
            minROLLRequired={minROLLRequired}
            maxROLLAllowed={maxROLLAllowed}
            rollBalance={rollBalance}
          />

          {/* Swap Button */}
          <Button
            onClick={handleSwap}
            disabled={
              isSwapping ||
              isTransactionPending ||
              isTransactionLoading ||
              !swapAmount ||
              swapAmount === "" ||
              !isDecryptReady ||
              (swapAmount && parseFloat(swapAmount) > maxETHAllowed)
            }
            className="w-full h-12 bg-gradient-to-r from-[#fde047] via-[#fbbf24] to-[#f59e0b] text-black hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100 shadow-lg shadow-[#fde047]/30"
          >
            {isTransactionPending ? "Confirm in MetaMask..." : isTransactionLoading ? "Processing..." : "Swap Tokens"}
          </Button>
          {isContractReady && (
            <Button
              onClick={onMintTokens}
              disabled={isContractLoading}
              className="w-full bg-gradient-to-r from-[#22c55e] to-[#16a34a] hover:from-[#16a34a] hover:to-[#15803d] text-white"
              size="sm"
            >
              {isContractLoading ? "Minting..." : "🪙 Mint 1000 ROLL (Testing)"}
            </Button>
          )}
        </div>
      </Card>

      {/* Loading Overlay */}
      {showLoadingOverlay && (
        <LoadingOverlay
          message="Transaction submitted successfully!"
          description="Waiting for blockchain confirmation. This may take a few seconds..."
          showDice={false}
        />
      )}
    </div>
  );
}
