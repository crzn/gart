import type { Role } from "@gart/shared";
import type { Env } from "../env";

export interface AuthContext {
  sessionId: string;
  adminId: string;
  email: string;
  displayName: string;
  role: Role;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; ip: string };
};
