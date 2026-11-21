import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AdminView } from "@gart/shared";
import { api, ApiError } from "./api";

type State = { status: "loading" } | { status: "anonymous" } | { status: "authenticated"; admin: AdminView };

interface AuthApi {
  state: State;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const { admin } = await api<{ admin: AdminView }>("/api/auth/me");
      setState({ status: "authenticated", admin });
    } catch (e) {
      // 401 means "not signed in"; any other failure also leaves the user on the login page,
      // where the form reports the real problem when they try to sign in.
      if (!(e instanceof ApiError)) throw e;
      setState({ status: "anonymous" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthApi>(
    () => ({
      state,
      refresh,
      async login(email, password) {
        const { admin } = await api<{ admin: AdminView }>("/api/auth/login", { method: "POST", body: { email, password } });
        setState({ status: "authenticated", admin });
      },
      async logout() {
        try {
          await api("/api/auth/logout", { method: "POST", body: {} });
        } finally {
          setState({ status: "anonymous" });
        }
      },
    }),
    [state, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
