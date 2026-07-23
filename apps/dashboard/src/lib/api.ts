const API = process.env.NEXT_PUBLIC_API_URL ?? "/api/proxy";

function apiBase(): string {
  const configured = API.replace(/\/$/, "");
  if (typeof window === "undefined") return configured;
  // Prefer same-origin proxy when configured for localhost Worker
  if (
    configured.startsWith("http") &&
    (configured.includes("127.0.0.1") || configured.includes("localhost"))
  ) {
    return "/api/proxy";
  }
  return configured || "/api/proxy";
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
