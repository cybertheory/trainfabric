// Prefer Cloudflare Worker API in production; /api/proxy is for local only.
const API =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://trainfabric-router.rishabhspro.workers.dev"
    : "/api/proxy");

const PUBLIC_WORKER = "https://trainfabric-router.rishabhspro.workers.dev";

function apiBase(): string {
  const configured = API.replace(/\/$/, "");
  if (typeof window === "undefined") return configured;
  // Localhost Worker → same-origin proxy (avoids private-network browser blocks)
  if (
    configured.startsWith("http") &&
    (configured.includes("127.0.0.1") || configured.includes("localhost"))
  ) {
    return "/api/proxy";
  }
  return configured || "/api/proxy";
}

/** Absolute Worker origin for docs / MCP / curl snippets (never the local proxy). */
export function publicApiOrigin(): string {
  const configured = (process.env.NEXT_PUBLIC_API_URL ?? PUBLIC_WORKER).replace(/\/$/, "");
  if (configured.includes("127.0.0.1") || configured.includes("localhost")) return PUBLIC_WORKER;
  if (configured.startsWith("http")) return configured;
  return PUBLIC_WORKER;
}

export async function apiFetch<T>(
  path: string,
  opts: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...init } = opts;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const base = apiBase();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export { API };
