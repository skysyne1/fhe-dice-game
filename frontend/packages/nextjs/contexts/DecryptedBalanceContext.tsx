"use client";

import { ReactNode, createContext, useContext, useEffect, useState } from "react";

interface DecryptedBalanceContextType {
  decryptedRollBalance: number | undefined;
  setDecryptedRollBalance: (balance: number | undefined) => void;
  lastDecryptedHandle: string;
  setLastDecryptedHandle: (handle: string) => void;
  clearCache: () => void;
}

const DecryptedBalanceContext = createContext<DecryptedBalanceContextType | undefined>(undefined);

// localStorage keys
const STORAGE_KEYS = {
  DECRYPTED_BALANCE: "fhe-dice-decrypted-balance",
  LAST_HANDLE: "fhe-dice-last-handle",
  CONTRACT_ADDRESS: "fhe-dice-contract-address",
};

export function DecryptedBalanceProvider({ children }: { children: ReactNode }) {
  const [decryptedRollBalance, setDecryptedRollBalance] = useState<number | undefined>(undefined);
  const [lastDecryptedHandle, setLastDecryptedHandle] = useState<string>("");

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const savedBalance = localStorage.getItem(STORAGE_KEYS.DECRYPTED_BALANCE);
      const savedHandle = localStorage.getItem(STORAGE_KEYS.LAST_HANDLE);

      if (savedBalance) {
        setDecryptedRollBalance(parseInt(savedBalance));
      }
      if (savedHandle) {
        setLastDecryptedHandle(savedHandle);
      }
    } catch (error) {
      console.warn("Failed to load cached balance:", error);
    }
  }, []);

  // Auto-save to localStorage when values change
  useEffect(() => {
    try {
      if (decryptedRollBalance !== undefined) {
        localStorage.setItem(STORAGE_KEYS.DECRYPTED_BALANCE, decryptedRollBalance.toString());
      } else {
        localStorage.removeItem(STORAGE_KEYS.DECRYPTED_BALANCE);
      }
    } catch (error) {
      console.warn("Failed to save balance to cache:", error);
    }
  }, [decryptedRollBalance]);

  useEffect(() => {
    try {
      if (lastDecryptedHandle) {
        localStorage.setItem(STORAGE_KEYS.LAST_HANDLE, lastDecryptedHandle);
      } else {
        localStorage.removeItem(STORAGE_KEYS.LAST_HANDLE);
      }
    } catch (error) {
      console.warn("Failed to save handle to cache:", error);
    }
  }, [lastDecryptedHandle]);

  // Clear cache function
  const clearCache = () => {
    try {
      localStorage.removeItem(STORAGE_KEYS.DECRYPTED_BALANCE);
      localStorage.removeItem(STORAGE_KEYS.LAST_HANDLE);
      setDecryptedRollBalance(undefined);
      setLastDecryptedHandle("");
      console.log("🧹 Cleared decrypted balance cache");
    } catch (error) {
      console.warn("Failed to clear cache:", error);
    }
  };

  return (
    <DecryptedBalanceContext.Provider
      value={{
        decryptedRollBalance,
        setDecryptedRollBalance,
        lastDecryptedHandle,
        setLastDecryptedHandle,
        clearCache,
      }}
    >
      {children}
    </DecryptedBalanceContext.Provider>
  );
}

export function useDecryptedBalance() {
  const context = useContext(DecryptedBalanceContext);
  if (context === undefined) {
    throw new Error("useDecryptedBalance must be used within a DecryptedBalanceProvider");
  }
  return context;
}
