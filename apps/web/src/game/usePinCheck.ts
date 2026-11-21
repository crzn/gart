import { useEffect, useState } from "react";

export interface PinInfo { over: boolean; title: string; description?: string; coverImageId?: string }
export type PinCheck = { status: "checking" | "missing" } | { status: "ok"; info: PinInfo | null };

/** Asks the server whether a game with this PIN exists, and what the join page may show about it. A network problem counts as "ok" without details: the game connection will report it. */
export async function lookupPin(pin: string): Promise<PinCheck> {
  try {
    const res = await fetch(`/api/join/${pin}`, { headers: { Accept: "application/json" } });
    if (res.status === 404) return { status: "missing" };
    if (!res.ok) return { status: "ok", info: null };
    const d = (await res.json()) as PinInfo & { ok?: boolean };
    return { status: "ok", info: { over: d.over === true, title: d.title, ...(d.description ? { description: d.description } : {}), ...(d.coverImageId ? { coverImageId: d.coverImageId } : {}) } };
  } catch {
    return { status: "ok", info: null };
  }
}

export async function pinExists(pin: string): Promise<"ok" | "missing"> {
  return (await lookupPin(pin)).status === "missing" ? "missing" : "ok";
}

export function usePinCheck(pin: string | null): PinCheck {
  const [result, setResult] = useState<{ pin: string; value: PinCheck } | null>(null);
  useEffect(() => {
    if (!pin) return;
    let alive = true;
    void lookupPin(pin).then((value) => { if (alive) setResult({ pin, value }); });
    return () => { alive = false; };
  }, [pin]);
  return !pin || result?.pin !== pin ? { status: "checking" } : result.value;
}
