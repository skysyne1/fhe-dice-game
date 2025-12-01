import { useState } from "react";
import { useDecryptedBalance } from "../../contexts/DecryptedBalanceContext";
import { LoadingOverlay } from "../LoadingOverlay";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { ethers } from "ethers";
import { Coins, Send } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "wagmi";

interface TransferTokensProps {
  balance: number;
  isContractReady: boolean;
  isContractLoading: boolean;
  contractError: string | null;
  isTransactionPending?: boolean;
  isTransactionLoading?: boolean;
  onTransferROLL: (recipientAddress: string, amount: number) => Promise<void>;
  onRefresh: () => Promise<void>;
  onClearError: () => void;
  onShowOverlay?: (message: string, description?: string, showDice?: boolean) => void;
  onHideOverlay?: () => void;
}

export function TransferTokens({
  balance,
  isContractReady,
  contractError,
  isTransactionPending = false,
  isTransactionLoading = false,
  onTransferROLL,
  onRefresh,
  onClearError,
  onShowOverlay,
  onHideOverlay,
}: TransferTokensProps) {
  const { address: walletAddress } = useAccount();
  const { decryptedRollBalance } = useDecryptedBalance();

  const [recipientAddress, setRecipientAddress] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);

  // LoadingOverlay should only show when transaction is submitted and waiting for confirmation
  const showLoadingOverlay = isTransactionLoading;

  const rollBalance = decryptedRollBalance !== undefined ? decryptedRollBalance : balance;

  // Check if user has decrypted ROLL balance for enabling transfer
  const isDecryptReady = decryptedRollBalance !== undefined;

  // Transfer validation constants
  const minROLLRequired = 1; // Minimum ROLL to transfer
  const maxROLLAllowed = 4294967295; // Max ROLL (uint32)

  // Handle amount change
  const handleAmountChange = (value: string) => {
    const numValue = parseFloat(value);

    // Limit to ROLL balance
    if (!isNaN(numValue) && numValue > rollBalance) {
      setTransferAmount(rollBalance.toString());
    } else {
      setTransferAmount(value);
    }
  };

  // Round amount when user finishes typing
  const handleAmountBlur = () => {
    const numValue = parseFloat(transferAmount);
    if (!isNaN(numValue) && numValue > 0) {
      // Round to nearest whole number
      const rounded = Math.round(numValue);
      setTransferAmount(rounded.toString());
    }
  };

  // Handle max amount
  const handleMaxAmount = () => {
    if (isDecryptReady && rollBalance > 0) {
      setTransferAmount(rollBalance.toString());
    }
  };

  // Handle transfer
  const handleTransfer = async () => {
    // Validate recipient address
    if (!recipientAddress || !ethers.isAddress(recipientAddress)) {
      toast.error("Invalid recipient address", {
        description: "Please enter a valid Ethereum address (0x...)",
      });
      return;
    }

    // Validate amount
    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (amount < minROLLRequired) {
      toast.error(`Minimum ${minROLLRequired} ROLL required`);
      return;
    }

    if (amount > maxROLLAllowed) {
      toast.error(`Maximum ${maxROLLAllowed.toLocaleString()} ROLL per transaction`);
      return;
    }

    // Check balance
    if (amount > rollBalance) {
      toast.error("Insufficient ROLL balance");
      return;
    }

    // Check self-transfer
    if (recipientAddress.toLowerCase() === walletAddress?.toLowerCase()) {
      toast.error("Cannot transfer to yourself");
      return;
    }

    if (!isContractReady) {
      toast.error("Smart contract not ready. Please check your network connection.");
      return;
    }

    // Show loading overlay and disable button
    setIsTransferring(true);
    onShowOverlay?.(
      "Transferring Tokens...",
      `Transferring ${amount} ROLL to ${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}. Confirm in MetaMask`,
      false,
    );

    try {
      await onTransferROLL(recipientAddress, amount);
      toast.success(`Transferred ${amount} ROLL to ${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`, {
        description: "Transaction confirmed on blockchain",
      });

      // Refresh balance
      await onRefresh();
      setRecipientAddress("");
      setTransferAmount("");
    } catch (error: any) {
      console.error("Transfer error:", error);

      // Check if user rejected the transaction
      if (error?.code === 4001 || error?.message?.includes("User denied") || error?.message?.includes("rejected")) {
        toast.error("Transaction cancelled", {
          description: "You cancelled the transaction in MetaMask",
        });
      } else {
        toast.error("Transfer failed", {
          description: error?.message || "Please try again",
        });
      }
    } finally {
      setIsTransferring(false);
      onHideOverlay?.();
    }
  };

  return (
    <div className="flex-1">
      <Card className="bg-gradient-to-br from-[#2a2a2a]/60 to-[#1a1a1a]/40 backdrop-blur-sm border-2 border-[#fde047]/30 p-6 shadow-2xl shadow-[#fde047]/10 lg:sticky lg:top-24">
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-4">
            <Send className="h-5 w-5 text-[#fde047] drop-shadow-[0_0_6px_rgba(253,224,71,0.4)]" />
            <h3 className="font-semibold text-[#fde047]">Transfer ROLL</h3>
          </div>

          {/* Info message */}
          <div
            className="text-sm text-center bg-gradient-to-r from-[#fde047] via-[#fef3c7] to-[#fed7aa] bg-clip-text text-transparent drop-shadow-sm font-semibold mb-2"
            style={{ letterSpacing: "0.01em" }}
          >
            Transfer ROLL tokens to another address with privacy-preserving encryption.
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

          {/* Recipient Address Input */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-[#d4d4d4]">Recipient Address</label>
            </div>
            <Input
              value={recipientAddress}
              onChange={e => setRecipientAddress(e.target.value)}
              className="h-14 text-base bg-[#2a2a2a] border-[#404040] focus:border-[#fde047] text-[#ffffff] placeholder:text-[#a3a3a3]"
              placeholder="0x..."
              disabled={isTransferring || !isDecryptReady}
            />
          </div>

          {/* Amount Input */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-[#d4d4d4]">Amount</label>
              <span className="text-sm text-[#a3a3a3]">Balance: {rollBalance.toLocaleString()} ROLL</span>
            </div>
            <div className="relative">
              <Input
                type="number"
                value={transferAmount}
                onChange={e => handleAmountChange(e.target.value)}
                onBlur={handleAmountBlur}
                className="h-14 text-xl pr-24 bg-[#2a2a2a] border-[#404040] focus:border-[#fde047] text-[#ffffff] placeholder:text-[#a3a3a3]"
                placeholder={isDecryptReady ? "0" : "Decrypt your ROLL balance to enable transfer"}
                disabled={isTransferring || !isDecryptReady}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-[#404040] px-3 py-2 rounded-lg">
                <Coins className="h-5 w-5 text-[#fde047]" />
                <span className="font-semibold text-[#ffffff]">ROLL</span>
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

          {/* Transfer Button */}
          <Button
            onClick={handleTransfer}
            disabled={
              isTransferring ||
              isTransactionPending ||
              isTransactionLoading ||
              !isContractReady ||
              !isDecryptReady ||
              !recipientAddress ||
              !transferAmount
            }
            className="w-full h-12 bg-gradient-to-r from-[#fde047] via-[#fbbf24] to-[#f59e0b] text-black hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100 shadow-lg shadow-[#fde047]/30 font-semibold text-base"
          >
            {isTransactionPending
              ? "Confirm in MetaMask..."
              : isTransactionLoading
                ? "Processing..."
                : isTransferring
                  ? "Transferring..."
                  : "Transfer ROLL"}
          </Button>
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
