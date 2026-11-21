import { useEffect, useState } from "react";

export type PinCheck = "checking" | "ok" | "missing";

/** Asks the server whether a game with this PIN exists. A network problem counts as "ok": the game connection will report it. */
export async function pinExists(pin: string): Promise<"ok" | "missing"> {
  try {
    const res = await fetch(`/api/join/${pin}`, { headers: { Accept: "application/json" } });
    return res.status === 404 ? "missing" : "ok";
  } catch {
    return "ok";
  }
}

export function usePinCheck(pin: string | null): PinCheck {
  const [result, setResult] = useState<{ pin: string; value: "ok" | "missing" } | null>(null);
  useEffect(() => {
    if (!pin) return;
    let alive = true;
    void pinExists(pin).then((value) => { if (alive) setResult({ pin, value }); });
    return () => { alive = false; };
  }, [pin]);
  return !pin || result?.pin !== pin ? "checking" : result.value;
}
