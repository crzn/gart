import { describe, expect, it } from "vitest";
import { signTicket, verifyTicket } from "./ticket";

const SECRET = "test-secret-0123456789-0123456789";
const base = { g: "game-1", r: "host" as const, a: "admin-1" };

describe("tickets", () => {
  it("round-trips", async () => {
    const t = await signTicket(SECRET, { ...base, e: Date.now() + 60_000 });
    const p = await verifyTicket(SECRET, t, Date.now());
    expect(p).toMatchObject(base);
    expect(p?.n.length).toBeGreaterThan(10);
  });
  it("gives every ticket its own nonce", async () => {
    const e = Date.now() + 60_000;
    const [a, b] = await Promise.all([signTicket(SECRET, { ...base, e }), signTicket(SECRET, { ...base, e })]);
    expect((await verifyTicket(SECRET, a, 0))?.n).not.toBe((await verifyTicket(SECRET, b, 0))?.n);
  });
  it("rejects a wrong secret, expiry and tampering", async () => {
    const e = Date.now() + 60_000;
    const t = await signTicket(SECRET, { ...base, e });
    expect(await verifyTicket("another-secret-0123456789-012345", t, 0)).toBeNull();
    expect(await verifyTicket(SECRET, t, e + 1)).toBeNull();
    const [body, mac] = t.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...base, r: "host", g: "game-2", e, n: "x" })).toString("base64url");
    expect(await verifyTicket(SECRET, `${forged}.${mac}`, 0)).toBeNull();
    expect(await verifyTicket(SECRET, `${body}.${mac.slice(0, -2)}AA`, 0)).toBeNull();
  });
  it("rejects garbage", async () => {
    for (const bad of ["", "abc", "a.b.c", "....", "!!.@@"]) expect(await verifyTicket(SECRET, bad, 0)).toBeNull();
  });
  it("rejects an unknown role even when correctly signed", async () => {
    const t = await signTicket(SECRET, { ...base, r: "root" as never, e: Date.now() + 1000 });
    expect(await verifyTicket(SECRET, t, 0)).toBeNull();
  });
});
