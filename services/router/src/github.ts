/**
 * GitHub App helpers — JWT app auth, installation tokens, user OAuth,
 * repo list/create, and starter-file seeding.
 */

import { SignJWT, importPKCS8 } from "jose";

export type GithubAppEnv = {
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_WEBHOOK_SECRET?: string;
  GITHUB_APP_STATE_SECRET?: string;
  AGENT_TOKEN_SECRET?: string;
  PUBLIC_API_BASE?: string;
  PUBLIC_API_URL?: string;
  DASHBOARD_URL?: string;
};

export type GithubInstallationAccount = {
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  accountId: number;
  avatarUrl?: string;
};

export type GithubRepoSummary = {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl: string;
  description?: string | null;
  updatedAt?: string | null;
};

const GH_API = "https://api.github.com";

function requireEnv(env: GithubAppEnv, key: keyof GithubAppEnv): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`${key} is not configured`);
  return v;
}

export function githubConfigured(env: GithubAppEnv): boolean {
  return Boolean(
    env.GITHUB_APP_ID?.trim() &&
      env.GITHUB_APP_SLUG?.trim() &&
      env.GITHUB_APP_CLIENT_ID?.trim() &&
      env.GITHUB_APP_CLIENT_SECRET?.trim() &&
      env.GITHUB_APP_PRIVATE_KEY?.trim(),
  );
}

export function stateSecret(env: GithubAppEnv): string {
  return (
    env.GITHUB_APP_STATE_SECRET?.trim() ||
    env.AGENT_TOKEN_SECRET?.trim() ||
    "dev-github-state-secret"
  );
}

export function publicApiOrigin(env: GithubAppEnv, reqUrl?: string): string {
  const configured = (env.PUBLIC_API_BASE || env.PUBLIC_API_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  if (reqUrl) return new URL(reqUrl).origin;
  throw new Error("PUBLIC_API_BASE is not configured");
}

export function dashboardOrigin(env: GithubAppEnv): string {
  return (env.DASHBOARD_URL || "http://localhost:3000").replace(/\/$/, "");
}

function normalizePem(pem: string): string {
  // Support wrangler secrets that store literal \n
  return pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
}

/** Create a short-lived GitHub App JWT (RS256). */
export async function createAppJwt(env: GithubAppEnv): Promise<string> {
  const appId = requireEnv(env, "GITHUB_APP_ID");
  const pem = normalizePem(requireEnv(env, "GITHUB_APP_PRIVATE_KEY"));
  const key = await importPKCS8(pem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .setIssuer(appId)
    .sign(key);
}

async function ghFetch<T>(
  path: string,
  opts: {
    token: string;
    method?: string;
    body?: unknown;
    accept?: string;
  },
): Promise<T> {
  const res = await fetch(path.startsWith("http") ? path : `${GH_API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: opts.accept ?? "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "trainfabric-router",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${opts.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function createInstallationAccessToken(
  env: GithubAppEnv,
  installationId: number,
): Promise<{ token: string; expiresAt: string }> {
  const jwt = await createAppJwt(env);
  const out = await ghFetch<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    { token: jwt, method: "POST", body: {} },
  );
  return { token: out.token, expiresAt: out.expires_at };
}

export type SignedInstallState = {
  userId: string;
  returnTo: string;
  nonce: string;
  exp: number;
  /** Carried across install → user OAuth when App install returns without `code`. */
  installationId?: number;
};

function toB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return toB64Url(new Uint8Array(sig));
}

export async function signInstallState(
  env: GithubAppEnv,
  payload: Omit<SignedInstallState, "exp" | "nonce"> & { nonce?: string; expSec?: number },
): Promise<string> {
  const body: SignedInstallState = {
    userId: payload.userId,
    returnTo: payload.returnTo,
    nonce: payload.nonce ?? crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + (payload.expSec ?? 600),
    ...(payload.installationId != null ? { installationId: payload.installationId } : {}),
  };
  const json = JSON.stringify(body);
  const payloadB64 = toB64Url(new TextEncoder().encode(json));
  const sig = await hmacSign(stateSecret(env), payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifyInstallState(
  env: GithubAppEnv,
  state: string,
): Promise<SignedInstallState> {
  const [payloadB64, sig] = state.split(".");
  if (!payloadB64 || !sig) throw new Error("Invalid state");
  const expected = await hmacSign(stateSecret(env), payloadB64);
  if (expected !== sig) throw new Error("Invalid state signature");
  const json = new TextDecoder().decode(fromB64Url(payloadB64));
  const body = JSON.parse(json) as SignedInstallState;
  if (!body.userId || !body.exp) throw new Error("Invalid state payload");
  if (body.exp < Math.floor(Date.now() / 1000)) throw new Error("State expired");
  return body;
}

/** Build GitHub App installation URL (with user OAuth during install). */
export function buildInstallUrl(env: GithubAppEnv, state: string): string {
  const slug = requireEnv(env, "GITHUB_APP_SLUG");
  const u = new URL(`https://github.com/apps/${slug}/installations/new`);
  u.searchParams.set("state", state);
  return u.href;
}

/** User-to-server OAuth authorize (used when install callback omits `code`). */
export function buildUserOAuthUrl(env: GithubAppEnv, state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", requireEnv(env, "GITHUB_APP_CLIENT_ID"));
  u.searchParams.set("state", state);
  return u.href;
}

export async function exchangeOAuthCode(
  env: GithubAppEnv,
  code: string,
): Promise<{ accessToken: string; tokenType?: string; scope?: string }> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "trainfabric-router",
    },
    body: JSON.stringify({
      client_id: requireEnv(env, "GITHUB_APP_CLIENT_ID"),
      client_secret: requireEnv(env, "GITHUB_APP_CLIENT_SECRET"),
      code,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth exchange failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!body.access_token) {
    throw new Error(body.error_description || body.error || "OAuth exchange missing access_token");
  }
  return {
    accessToken: body.access_token,
    tokenType: body.token_type,
    scope: body.scope,
  };
}

export async function getGithubUser(accessToken: string): Promise<{
  id: number;
  login: string;
  avatarUrl?: string;
  name?: string | null;
  email?: string | null;
}> {
  const u = await ghFetch<{
    id: number;
    login: string;
    avatar_url?: string;
    name?: string | null;
    email?: string | null;
  }>("/user", { token: accessToken });
  return {
    id: u.id,
    login: u.login,
    avatarUrl: u.avatar_url,
    name: u.name,
    email: u.email,
  };
}

export async function listUserInstallations(
  accessToken: string,
): Promise<GithubInstallationAccount[]> {
  const out: GithubInstallationAccount[] = [];
  let page = 1;
  for (;;) {
    const batch = await ghFetch<{
      installations: Array<{
        id: number;
        account: { login: string; id: number; type: string; avatar_url?: string } | null;
        suspended_at?: string | null;
      }>;
      total_count: number;
    }>(`/user/installations?per_page=100&page=${page}`, { token: accessToken });
    for (const inst of batch.installations ?? []) {
      if (!inst.account || inst.suspended_at) continue;
      out.push({
        installationId: inst.id,
        accountLogin: inst.account.login,
        accountType: inst.account.type === "Organization" ? "Organization" : "User",
        accountId: inst.account.id,
        avatarUrl: inst.account.avatar_url,
      });
    }
    if ((batch.installations?.length ?? 0) < 100) break;
    page += 1;
    if (page > 20) break;
  }
  return out;
}

export async function listInstallationRepos(
  env: GithubAppEnv,
  installationId: number,
  opts?: { page?: number; perPage?: number },
): Promise<GithubRepoSummary[]> {
  const { token } = await createInstallationAccessToken(env, installationId);
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 50;
  const batch = await ghFetch<{
    repositories: Array<{
      id: number;
      full_name: string;
      name: string;
      private: boolean;
      default_branch: string;
      html_url: string;
      clone_url: string;
      description?: string | null;
      updated_at?: string | null;
    }>;
  }>(`/installation/repositories?per_page=${perPage}&page=${page}`, { token });
  return (batch.repositories ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    name: r.name,
    private: r.private,
    defaultBranch: r.default_branch || "main",
    htmlUrl: r.html_url,
    cloneUrl: r.clone_url,
    description: r.description,
    updatedAt: r.updated_at,
  }));
}

export const REPO_STARTER_FILES: Record<string, string> = {
  "TRAINFABRIC.md": `# Autoresearch brief

Describe the research goal for this campaign. The Trainfabric agent loads this file after clone.

## Goal

Improve the target metric under the immutable eval protocol.

## Dataset hints

Mention lakehouse datasets or schemas the agent should discover and bind.
`,
  "AGENTS.md": `# Agent notes

- Mutable paths are listed in \`protocol.yaml\` — only edit those.
- Never change immutable eval files.
- Keep commits small and push only when a trial improves the metric.
`,
  "protocol.yaml": `metric:
  name: val_bpb
  direction: min
budget:
  maxTrials: 20
  maxWallClockSec: 3600
mutablePaths:
  - train.py
immutablePaths:
  - prepare.py
  - protocol.yaml
`,
  ".gitignore": `__pycache__/
*.pyc
.env
.venv/
node_modules/
.DS_Store
*.pt
*.ckpt
wandb/
`,
};

async function putFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
): Promise<void> {
  const encoded = btoa(unescape(encodeURIComponent(content)));
  await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, {
    token,
    method: "PUT",
    body: {
      message,
      content: encoded,
      branch,
    },
  });
}

export async function createRepoUnderInstallation(
  env: GithubAppEnv,
  opts: {
    installationId: number;
    accountLogin: string;
    accountType: "User" | "Organization";
    name: string;
    private?: boolean;
    description?: string;
    defaultBranch?: string;
  },
): Promise<GithubRepoSummary & { createdFromPlatform: true }> {
  const name = opts.name.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error("Invalid repo name — use letters, numbers, ., -, _");
  }
  const { token } = await createInstallationAccessToken(env, opts.installationId);
  const defaultBranch = opts.defaultBranch?.trim() || "main";
  const body = {
    name,
    private: opts.private !== false,
    description: opts.description?.trim() || "Trainfabric autoresearch campaign",
    auto_init: true,
    has_issues: true,
    has_projects: false,
    has_wiki: false,
  };

  const created =
    opts.accountType === "Organization"
      ? await ghFetch<{
          id: number;
          full_name: string;
          name: string;
          private: boolean;
          default_branch: string;
          html_url: string;
          clone_url: string;
          description?: string | null;
        }>(`/orgs/${opts.accountLogin}/repos`, { token, method: "POST", body })
      : await ghFetch<{
          id: number;
          full_name: string;
          name: string;
          private: boolean;
          default_branch: string;
          html_url: string;
          clone_url: string;
          description?: string | null;
        }>(`/user/repos`, { token, method: "POST", body });

  const owner = created.full_name.split("/")[0]!;
  const repo = created.name;
  const branch = created.default_branch || defaultBranch;

  // Seed starter files (auto_init creates README — we add the rest).
  for (const [path, content] of Object.entries(REPO_STARTER_FILES)) {
    await putFile(token, owner, repo, path, content, `Add ${path}`, branch);
  }

  return {
    id: created.id,
    fullName: created.full_name,
    name: created.name,
    private: created.private,
    defaultBranch: branch,
    htmlUrl: created.html_url,
    cloneUrl: created.clone_url,
    description: created.description,
    createdFromPlatform: true,
  };
}

/** Verify GitHub webhook HMAC-SHA256 signature. */
export async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null | undefined,
): Promise<boolean> {
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const expected = `sha256=${hex}`;
  if (expected.length !== signatureHeader.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) {
    ok |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return ok === 0;
}

export function githubHttpsCloneUrl(fullName: string): string {
  return `https://github.com/${fullName.replace(/\.git$/, "")}.git`;
}

export function authenticatedCloneUrl(token: string, fullName: string): string {
  const clean = fullName.replace(/\.git$/, "").replace(/^https?:\/\/github\.com\//, "");
  return `https://x-access-token:${token}@github.com/${clean}.git`;
}
