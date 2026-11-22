// A visitor (no account) who started a game from the showcase keeps the host secret for that game in this browser tab only.
// It lives in sessionStorage, so it is gone when the tab closes; the server keeps only its hash.

export interface GuestGame { id: string; pin: string; title: string; hostToken: string; maxPlayers: number }

const key = (id: string) => `gart.guest.${id}`;

export function saveGuest(g: GuestGame): void {
  try { sessionStorage.setItem(key(g.id), JSON.stringify(g)); } catch { /* storage unavailable: the game cannot be controlled from a reload */ }
}

export function loadGuest(id: string): GuestGame | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(key(id)) ?? "null") as Partial<GuestGame> | null;
    return v && v.id === id && typeof v.hostToken === "string" && typeof v.pin === "string" && typeof v.title === "string"
      ? { id, pin: v.pin, title: v.title, hostToken: v.hostToken, maxPlayers: typeof v.maxPlayers === "number" ? v.maxPlayers : 10 }
      : null;
  } catch { return null; }
}

/** The projector link carries the secret in the address fragment, which the browser never sends to the server.
 *  The projector's tab stores it and removes it from the address at once. */
export function projectorHref(g: GuestGame | null, id: string): string {
  if (!g) return `/screen/${id}`;
  return `/screen/${id}#k=${encodeURIComponent(g.hostToken)}&p=${encodeURIComponent(g.pin)}&t=${encodeURIComponent(g.title)}&m=${g.maxPlayers}`;
}

export function takeGuestFromHash(id: string): GuestGame | null {
  const h = new URLSearchParams(location.hash.slice(1));
  const k = h.get("k");
  if (!k) return loadGuest(id);
  const g: GuestGame = { id, pin: h.get("p") ?? "", title: h.get("t") ?? "", hostToken: k, maxPlayers: Number(h.get("m")) || 10 };
  saveGuest(g);
  history.replaceState(null, "", location.pathname + location.search);
  return g;
}
