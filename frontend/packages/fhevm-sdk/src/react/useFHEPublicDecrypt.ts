"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { FhevmInstance } from "../fhevmTypes.js";

export type FHEPublicDecryptRequest = { handle: string; contractAddress: `0x${string}` };

export const useFHEPublicDecrypt = (params: {
  instance: FhevmInstance | undefined;
  chainId: number | undefined;
  requests: readonly FHEPublicDecryptRequest[] | undefined;
}) => {
  const { instance, chainId, requests } = params;

  const [isDecrypting, setIsDecrypting] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [results, setResults] = useState<Record<string, string | bigint | boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const isDecryptingRef = useRef<boolean>(isDecrypting);
  const lastReqKeyRef = useRef<string>("");

  const requestsKey = useMemo(() => {
    if (!requests || requests.length === 0) return "";
    const sorted = [...requests].sort((a, b) =>
      (a.handle + a.contractAddress).localeCompare(b.handle + b.contractAddress),
    );
    return JSON.stringify(sorted);
  }, [requests]);

  const canDecrypt = useMemo(() => {
    return Boolean(instance && requests && requests.length > 0 && !isDecrypting);
  }, [instance, requests, isDecrypting]);

  const decrypt = useCallback(() => {
    if (isDecryptingRef.current) return;
    if (!instance || !requests || requests.length === 0) return;

    const thisChainId = chainId;
    const thisRequests = requests;

    // Capture the current requests key to avoid false "stale" detection on first run
    lastReqKeyRef.current = requestsKey;

    isDecryptingRef.current = true;
    setIsDecrypting(true);
    setMessage("Start public decrypt");
    setError(null);

    const run = async () => {
      const isStale = () =>
        thisChainId !== chainId || requestsKey !== lastReqKeyRef.current;

      try {
        setMessage("Call FHEVM publicDecrypt...");

        const handles = thisRequests.map(r => r.handle);
        let res: Record<string, string | bigint | boolean> = {};
        
        try {
          // Use publicDecrypt with array of handles
          const publicDecryptResult = await instance.publicDecrypt(handles);
          
          // Convert result to expected format - clearValues is an object with handle as key
          if (publicDecryptResult.clearValues) {
            for (const handle of handles) {
              if (handle in publicDecryptResult.clearValues) {
                res[handle] = (publicDecryptResult.clearValues as any)[handle];
              }
            }
          }
        } catch (e) {
          const err = e as unknown as { name?: string; message?: string };
          const code = err && typeof err === "object" && "name" in (err as any) ? (err as any).name : "PUBLIC_DECRYPT_ERROR";
          
          if (isStale()) {
            setMessage("Ignore FHEVM public decryption");
            return;
          }
          
          setError(`${code}: ${err?.message || "Public decryption failed"}`);
          return;
        }

        if (isStale()) {
          setMessage("Ignore FHEVM public decryption");
          return;
        }

        setResults(res);
        setMessage("FHEVM public decryption completed");
      } catch (error) {
        if (isStale()) {
          setMessage("Ignore FHEVM public decryption");
          return;
        }
        
        const err = error as unknown as { message?: string };
        setError(`PUBLIC_DECRYPT_ERROR: ${err?.message || "Unknown error during public decryption"}`);
      } finally {
        isDecryptingRef.current = false;
        setIsDecrypting(false);
        lastReqKeyRef.current = requestsKey;
      }
    };

    run();
  }, [instance, chainId, requests, requestsKey]);

  return { canDecrypt, decrypt, isDecrypting, message, results, error, setMessage, setError } as const;
};