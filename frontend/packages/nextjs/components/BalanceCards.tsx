import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDecrypt } from "../../fhevm-sdk/src/adapters/useDecrypt";
import { initializeFheInstance } from "../../fhevm-sdk/src/core";
import { useDecryptedBalance } from "../contexts/DecryptedBalanceContext";
import { useEncryptedDiceGame } from "../hooks/useEncryptedDiceGame";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Coins, RefreshCw } from "lucide-react";
import { useAccount, useBalance } from "wagmi";

export function BalanceCards() {
  const { address } = useAccount();
  const {
    data: ethBalanceData,
    refetch: refetchEthBalance,
    isFetching: isEthFetching,
  } = useBalance({
    address,
    query: {
      enabled: Boolean(address),
    },
  });

  const { encryptedBalance, refreshBalance, isLoading, isContractReady, contractAddress } = useEncryptedDiceGame();
  const { decryptedRollBalance, setDecryptedRollBalance, lastDecryptedHandle, setLastDecryptedHandle, clearCache } =
    useDecryptedBalance();

  const { decrypt } = useDecrypt();

  // Manual decrypt state
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isEthRefreshing, setIsEthRefreshing] = useState(false);
  const [isRollRefreshing, setIsRollRefreshing] = useState(false);

  const ethBalance = ethBalanceData ? parseFloat(ethBalanceData.formatted) : 0;

  // Reset decrypted balance when encrypted balance handle changes
  useEffect(() => {
    console.log("🎯 BalanceCards state:", { encryptedBalance, decryptedRollBalance, isContractReady });
    if (encryptedBalance && encryptedBalance !== lastDecryptedHandle) {
      setDecryptedRollBalance(undefined);
      setLastDecryptedHandle("");
    }
  }, [
    encryptedBalance,
    lastDecryptedHandle,
    decryptedRollBalance,
    isContractReady,
    setDecryptedRollBalance,
    setLastDecryptedHandle,
  ]);

  // Manual decrypt function (replaces makeBalancePublic)
  const makeBalancePublic = async () => {
    if (!encryptedBalance || !isContractReady || !contractAddress) {
      console.warn("❌ Cannot decrypt: Missing encrypted balance, contract not ready, or no contract address");
      return;
    }

    setIsDecrypting(true);

    try {
      console.log("🔐 Starting manual decrypt for balance:", encryptedBalance);

      // Ensure FHEVM is initialized before decryption
      console.log("🔄 Ensuring FHEVM is initialized...");
      await initializeFheInstance();
      console.log("✅ FHEVM initialization confirmed");

      // Use template's decrypt with EIP-712 signature - need signer
      if (!window.ethereum) {
        throw new Error("MetaMask not found");
      }

      const { ethers } = await import("ethers");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const decryptedValue = await decrypt(encryptedBalance, contractAddress, signer);

      console.log("✅ Decryption successful:", decryptedValue);
      setDecryptedRollBalance(decryptedValue);
      setLastDecryptedHandle(encryptedBalance);

      // Show success feedback
      console.log("🎉 Balance decrypted successfully! Value:", decryptedValue, "ROLL");
    } catch (error: any) {
      console.error("❌ Decryption failed:", error);

      // Check if error is due to invalid handle (contract was redeployed)
      if (
        error?.message?.includes("is not of valid type") ||
        error?.message?.includes("Handle") ||
        error?.message?.includes("Failed to fetch")
      ) {
        console.log("🔄 Invalid handle detected, clearing cache...");
        clearCache();
        toast.error("Balance cache expired", {
          description: "Contract was redeployed. Please mint new tokens first.",
        });
      } else {
        toast.error("Decryption failed", {
          description: error?.message || "Please try again",
        });
      }
    } finally {
      setIsDecrypting(false);
    }
  };

  const handleRefreshEthBalance = async () => {
    if (!address || !refetchEthBalance) return;
    try {
      setIsEthRefreshing(true);
      await refetchEthBalance();
    } finally {
      setIsEthRefreshing(false);
    }
  };

  const handleRefreshRollBalance = async () => {
    if (!isContractReady) return;
    try {
      setIsRollRefreshing(true);
      await refreshBalance();
    } finally {
      setIsRollRefreshing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
      {/* ROLL Balance */}
      <Card className="relative overflow-hidden bg-gradient-to-br from-[#2a2a2a] to-[#1a1a1a] border-2 border-[#fde047]/30 hover:border-[#fde047]/50 transition-all duration-300 hover:shadow-2xl hover:shadow-[#fde047]/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#fde047]/10 via-[#fef3c7]/5 to-transparent" />
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[#fde047]/20 to-transparent rounded-full blur-3xl" />
        <div className="relative p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-[#fde047]/30 to-[#fbbf24]/20 border border-[#fde047]/20">
                <Coins className="h-5 w-5 text-[#fde047]" />
              </div>
              <span className="text-[#d4d4d4]">ROLL Balance</span>
            </div>
            <div className="flex items-center gap-2">
              {isContractReady && (
                <Button
                  onClick={handleRefreshRollBalance}
                  disabled={isLoading || isRollRefreshing}
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isLoading || isRollRefreshing ? "animate-spin" : ""}`}
                  />
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2">
            {decryptedRollBalance !== undefined ? (
              // Decrypted balance
              <>
                <div className="text-3xl font-bold bg-gradient-to-r from-[#fde047] via-[#fef3c7] to-[#fed7aa] bg-clip-text text-transparent drop-shadow-sm">
                  {decryptedRollBalance.toLocaleString()}
                </div>
                <div className="text-sm text-[#a3a3a3] mt-1">≈ ${(decryptedRollBalance * 0.001).toFixed(2)} USD</div>
              </>
            ) : encryptedBalance ? (
              // Encrypted balance
              <>
                <div className="text-lg font-mono text-[#fde047] break-all">
                  🔐
                  {(() => {
                    let balanceStr = encryptedBalance;
                    // Ensure it starts with 0x
                    if (balanceStr && !balanceStr.startsWith("0x")) {
                      balanceStr = "0x" + balanceStr;
                    }
                    // Show first 20 characters + ...
                    return balanceStr && balanceStr.length > 20 ? balanceStr.substring(0, 20) + "..." : balanceStr;
                  })()}
                </div>
                <div className="text-sm text-[#a3a3a3] mt-1">
                  Balance is encrypted – decrypt with your wallet to view
                </div>
                <Button
                  onClick={makeBalancePublic}
                  disabled={isLoading || isDecrypting}
                  size="sm"
                  className="mt-2 bg-[#fde047]/20 hover:bg-[#fde047]/30 text-[#fde047] border border-[#fde047]/30"
                >
                  {isDecrypting ? "Decrypting..." : "Decrypt Balance"}
                </Button>
              </>
            ) : (
              // No balance
              <>
                <div className="text-3xl font-bold text-[#666]">---</div>
                <div className="text-sm text-[#a3a3a3] mt-1">Connect wallet to view balance</div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ETH Balance */}
      <Card className="relative overflow-hidden bg-gradient-to-br from-[#2a2a2a] to-[#1a1a1a] border-2 border-[#404040] hover:border-[#fde047]/30 transition-all duration-300 hover:shadow-xl hover:shadow-[#404040]/20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#fed7aa]/5 to-transparent" />
        <div className="relative p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-[#fed7aa]/20 to-[#fbbf24]/10 border border-[#fed7aa]/10">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z"
                    fill="currentColor"
                    className="text-[#fbbf24]"
                  />
                </svg>
              </div>
              <span className="text-[#d4d4d4]">ETH Balance</span>
            </div>
            {address && (
              <Button
                onClick={handleRefreshEthBalance}
                disabled={isEthRefreshing || isEthFetching}
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
              >
                <RefreshCw className={`h-4 w-4 ${(isEthRefreshing || isEthFetching) ? "animate-spin" : ""}`} />
              </Button>
            )}
          </div>
          <div className="mt-2">
            <div className="text-3xl font-bold text-[#ffffff]">{address ? ethBalance.toFixed(4) : "---"}</div>
            <div className="text-sm text-[#a3a3a3] mt-1">
              {address ? `≈ $${(ethBalance * 2500).toFixed(2)} USD` : "Connect wallet to view balance"}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
