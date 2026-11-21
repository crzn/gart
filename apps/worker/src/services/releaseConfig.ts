import release from "../../../../config/release.json";
import type { Env } from "../env";

/** Where releases come from and which key signs them. The environment overrides exist for tests only. */
export function releaseConfig(env: Env): { repo: string; apiBase: string; dlBase: string; cfBase: string; publicKey: JsonWebKey } {
  return {
    repo: release.repo,
    apiBase: (env.RELEASE_API_BASE ?? "https://api.github.com").replace(/\/+$/, ""),
    dlBase: (env.RELEASE_DL_BASE ?? "https://github.com").replace(/\/+$/, ""),
    cfBase: (env.CF_API_BASE ?? "https://api.cloudflare.com/client/v4").replace(/\/+$/, ""),
    publicKey: env.RELEASE_PUBLIC_KEY ? (JSON.parse(env.RELEASE_PUBLIC_KEY) as JsonWebKey) : (release.publicKey as JsonWebKey),
  };
}
