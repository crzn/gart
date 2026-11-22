/** Thin fetch wrapper for the Gart API. Adds the CSRF header and normalises errors. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly problems: string[] = [],
    public readonly payload: unknown = null,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "x-gart-csrf": "1",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (for example a proxy error page); handled below.
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; problems?: string[] };
    throw new ApiError(res.status, d.error ?? "unknown", d.problems ?? [], data);
  }
  return data as T;
}
