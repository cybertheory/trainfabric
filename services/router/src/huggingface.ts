/**
 * Hugging Face OAuth — Sign in with HF for private/gated dataset pulls.
 * Tokens are stored encrypted and keyed by Clerk userId.
 */

import { SignJWT, jwtVerify } from "jose";

export type HfOAuthEnv = {
  HF_OAUTH_CLIENT_ID?: string;
  HF_OAUTH_CLIENT_SECRET?: string;
  HF_OAUTH_STATE_SECRET?: string;
  GITHUB_TOKEN_CRYPTO_KEY?: string;
  GITHUB_APP_STATE_SECRET?: string;
  AGENT_TOKEN_SECRET?: string;
  PUBLIC_API_BASE?: string;
  PUBLIC_API_URL?: string;
  DASHBOARD_URL?: string;
};

const HF_AUTHORIZE = "https://huggingface.co/oauth/authorize";
const HF_TOKEN = "https://huggingface.co/oauth/token";
const HF_USERINFO = "https://huggingface.co/oauth/userinfo";
const HF_API = "https://huggingface.co/api";

export function hfConfigured(env: HfOAuthEnv): boolean {
  return Boolean(env.HF_OAUTH_CLIENT_ID?.trim() && env.HF_OAUTH_CLIENT_SECRET?.trim());
}

function requireEnv(env: HfOAuthEnv, key: keyof HfOAuthEnv): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`${key} is not configured`);
  return v;
}

export function hfStateSecret(env: HfOAuthEnv): string {
  return (
    env.HF_OAUTH_STATE_SECRET?.trim() ||
    env.GITHUB_APP_STATE_SECRET?.trim() ||
    env.AGENT_TOKEN_SECRET?.trim() ||
    "dev-hf-state-secret"
  );
}

export function hfPublicApiOrigin(env: HfOAuthEnv, reqUrl?: string): string {
  const configured = (env.PUBLIC_API_BASE || env.PUBLIC_API_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  if (reqUrl) return new URL(reqUrl).origin;
  throw new Error("PUBLIC_API_BASE is not configured");
}

export function hfDashboardOrigin(env: HfOAuthEnv): string {
  return (env.DASHBOARD_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function signHfOAuthState(
  env: HfOAuthEnv,
  payload: { userId: string; returnTo?: string },
): Promise<string> {
  const secret = new TextEncoder().encode(hfStateSecret(env));
  return new SignJWT({
    userId: payload.userId,
    returnTo: payload.returnTo || "/new",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

export async function verifyHfOAuthState(
  env: HfOAuthEnv,
  state: string,
): Promise<{ userId: string; returnTo?: string }> {
  const secret = new TextEncoder().encode(hfStateSecret(env));
  const { payload } = await jwtVerify(state, secret);
  const userId = String(payload.userId || "");
  if (!userId) throw new Error("Invalid state payload");
  return {
    userId,
    returnTo: payload.returnTo ? String(payload.returnTo) : "/new",
  };
}

export function buildHfConnectUrl(env: HfOAuthEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv(env, "HF_OAUTH_CLIENT_ID"),
    redirect_uri: `${hfPublicApiOrigin(env)}/huggingface/callback`,
    response_type: "code",
    // read-repos includes gated-repos on HF's app settings.
    scope: "openid profile read-repos",
    state,
  });
  // HF wraps authorize in /login?next=…; form-encoding spaces as "+" becomes literal "+"
  // after that hop and HF treats "openid+profile+…" as an invalid scope → 404.
  return `${HF_AUTHORIZE}?${params.toString().replace(/\+/g, "%20")}`;
}

export async function exchangeHfOAuthCode(
  env: HfOAuthEnv,
  code: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
  const clientId = requireEnv(env, "HF_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv(env, "HF_OAUTH_CLIENT_SECRET");
  const redirectUri = `${hfPublicApiOrigin(env)}/huggingface/callback`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
  });
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(HF_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
      "User-Agent": "trainfabric-router",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HF OAuth exchange failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!json.access_token) {
    throw new Error(json.error_description || json.error || "HF OAuth missing access_token");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  };
}

export async function getHfUser(accessToken: string): Promise<{
  sub: string;
  name?: string;
  preferredUsername?: string;
  picture?: string;
}> {
  const res = await fetch(HF_USERINFO, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "trainfabric-router",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HF userinfo failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const u = (await res.json()) as {
    sub: string;
    name?: string;
    preferred_username?: string;
    picture?: string;
  };
  return {
    sub: u.sub,
    name: u.name,
    preferredUsername: u.preferred_username,
    picture: u.picture,
  };
}

export type HfDatasetSummary = {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  private?: boolean;
  gated?: boolean | string;
  lastModified?: string;
};

/** List datasets the token can see (author filter optional). */
export async function listHfDatasets(
  accessToken: string,
  opts?: { search?: string; author?: string; limit?: number },
): Promise<HfDatasetSummary[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
  const u = new URL(`${HF_API}/datasets`);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("full", "true");
  if (opts?.search?.trim()) u.searchParams.set("search", opts.search.trim());
  if (opts?.author?.trim()) u.searchParams.set("author", opts.author.trim());

  const res = await fetch(u.href, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "trainfabric-router",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HF datasets list failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const rows = (await res.json()) as Array<{
    id: string;
    author?: string;
    downloads?: number;
    likes?: number;
    private?: boolean;
    gated?: boolean | string;
    lastModified?: string;
  }>;
  return (rows ?? []).map((r) => ({
    id: r.id,
    author: r.author,
    downloads: r.downloads,
    likes: r.likes,
    private: r.private,
    gated: r.gated,
    lastModified: r.lastModified,
  }));
}

export function hfDatasetUrl(repoId: string, revision = "main", path = ""): string {
  const base = `https://huggingface.co/datasets/${repoId}`;
  if (!path) return `${base}/tree/${revision}`;
  return `${base}/tree/${revision}/${path.replace(/^\//, "")}`;
}
