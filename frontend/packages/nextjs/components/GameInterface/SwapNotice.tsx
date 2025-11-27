import React from "react";

interface SwapNoticeProps {
  isDecryptReady: boolean;
  swapAmount: string;
  swapDirection: "ETH_TO_ROLL" | "ROLL_TO_ETH";
  minETHRequired: number;
  maxETHAllowed: number;
  minROLLRequired: number;
  maxROLLAllowed: number;
  rollBalance: number;
}

export function SwapNotice({
  isDecryptReady,
  swapAmount,
  swapDirection,
  minETHRequired,
  maxETHAllowed,
  minROLLRequired,
  maxROLLAllowed,
  rollBalance,
}: SwapNoticeProps) {
  const amount = parseFloat(swapAmount) || 0;

  // Priority order: decrypt > insufficient balance > max amount
  if (!isDecryptReady) {
    return (
      <div className="text-xs text-center bg-gradient-to-r from-[#fde047] via-[#fef3c7] to-[#fed7aa] bg-clip-text text-transparent drop-shadow-sm font-semibold">
        You must decrypt your ROLL balance before swapping.
      </div>
    );
  }

  if (swapDirection === "ETH_TO_ROLL") {
    // ETH → ROLL validation
    if (swapAmount && amount > maxETHAllowed) {
      return (
        <div className="text-xs text-center bg-gradient-to-r from-[#fde047] via-[#fef3c7] to-[#fed7aa] bg-clip-text text-transparent drop-shadow-sm font-semibold">
          Amount too large. Max 4,294 ETH per swap.
        </div>
      );
    }
  } else {
    // ROLL → ETH validation
    if (swapAmount && amount > rollBalance) {
      return (
        <div className="text-xs text-center bg-gradient-to-r from-[#fde047] via-[#fef3c7] to-[#fed7aa] bg-clip-text text-transparent drop-shadow-sm font-semibold">
          Insufficient ROLL balance.
        </div>
      );
    }

    if (swapAmount && amount > maxROLLAllowed) {
      return (
        <div className="text-xs text-center bg-gradient-to-r from-[#fde047] via-[#fef3c7] to-[#fed7aa] bg-clip-text text-transparent drop-shadow-sm font-semibold">
          Amount too large. Max 4,294,967,295 ROLL per swap.
        </div>
      );
    }
  }

  return null;
}
