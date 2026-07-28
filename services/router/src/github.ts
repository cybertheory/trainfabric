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

/** True if the App installation still exists on GitHub (false after uninstall). */
export async function installationExistsOnGithub(
  env: GithubAppEnv,
  installationId: number,
): Promise<boolean> {
  const jwt = await createAppJwt(env);
  const res = await fetch(`${GH_API}/app/installations/${installationId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "trainfabric-router",
    },
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub GET /app/installations/${installationId} → ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return true;
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

/** User-to-server OAuth authorize (preferred Connect entrypoint). */
export function buildUserOAuthUrl(env: GithubAppEnv, state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", requireEnv(env, "GITHUB_APP_CLIENT_ID"));
  u.searchParams.set("state", state);
  u.searchParams.set("redirect_uri", `${publicApiOrigin(env)}/github/callback`);
  return u.href;
}

/** URL returned by Connect GitHub — OAuth first, then App install if needed. */
export function buildConnectUrl(env: GithubAppEnv, state: string): string {
  return buildUserOAuthUrl(env, state);
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
      redirect_uri: `${publicApiOrigin(env)}/github/callback`,
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
  opts?: { page?: number; perPage?: number; allPages?: boolean },
): Promise<{
  repos: GithubRepoSummary[];
  totalCount: number;
  repositorySelection?: "all" | "selected";
}> {
  const { token } = await createInstallationAccessToken(env, installationId);
  const perPage = Math.min(Math.max(opts?.perPage ?? 100, 1), 100);
  const allPages = opts?.allPages !== false;
  const startPage = opts?.page ?? 1;

  const repos: GithubRepoSummary[] = [];
  let totalCount = 0;
  let repositorySelection: "all" | "selected" | undefined;
  let page = startPage;

  for (;;) {
    const batch = await ghFetch<{
      total_count?: number;
      repository_selection?: "all" | "selected";
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

    if (typeof batch.total_count === "number") totalCount = batch.total_count;
    if (batch.repository_selection) repositorySelection = batch.repository_selection;

    for (const r of batch.repositories ?? []) {
      repos.push({
        id: r.id,
        fullName: r.full_name,
        name: r.name,
        private: r.private,
        defaultBranch: r.default_branch || "main",
        htmlUrl: r.html_url,
        cloneUrl: r.clone_url,
        description: r.description,
        updatedAt: r.updated_at,
      });
    }

    const got = batch.repositories?.length ?? 0;
    if (!allPages || got < perPage || repos.length >= (totalCount || Infinity)) break;
    page += 1;
    if (page > 50) break; // hard cap ~5k repos
  }

  if (!totalCount) totalCount = repos.length;
  return { repos, totalCount, repositorySelection };
}

export type GithubTreeEntry = {
  path: string;
  type: "file" | "dir";
  size?: number;
  /** True when file has an ingest-allowed extension */
  ingestible?: boolean;
};

/** List files/dirs under a path for the publish picker (non-recursive one level, or recursive tabular files). */
export async function listInstallationRepoTree(
  env: GithubAppEnv,
  installationId: number,
  opts: {
    owner: string;
    repo: string;
    ref?: string;
    path?: string;
    recursive?: boolean;
  },
): Promise<{ ref: string; entries: GithubTreeEntry[] }> {
  const { token } = await createInstallationAccessToken(env, installationId);
  const ref = opts.ref || "main";
  const path = (opts.path || "").replace(/^\/+|\/+$/g, "");

  if (opts.recursive) {
    // Resolve SHA then recursive tree; filter to ingestible files under path prefix.
    let sha: string | undefined;
    try {
      const refMeta = await ghFetch<{ object?: { sha?: string }; sha?: string }>(
        `/repos/${opts.owner}/${opts.repo}/git/ref/heads/${encodeURIComponent(ref)}`,
        { token },
      );
      sha = refMeta.object?.sha ?? refMeta.sha;
    } catch {
      const commit = await ghFetch<{ sha?: string }>(
        `/repos/${opts.owner}/${opts.repo}/commits/${encodeURIComponent(ref)}`,
        { token },
      );
      sha = commit.sha;
    }
    if (!sha) return { ref, entries: [] };
    const tree = await ghFetch<{
      tree: { path: string; type: string; size?: number }[];
    }>(`/repos/${opts.owner}/${opts.repo}/git/trees/${sha}?recursive=1`, { token });
    const prefix = path;
    const entries: GithubTreeEntry[] = [];
    for (const node of tree.tree ?? []) {
      if (node.type !== "blob") continue;
      if (prefix && node.path !== prefix && !node.path.startsWith(prefix + "/")) continue;
      const lower = node.path.toLowerCase();
      const ingestible = [".parquet", ".parq", ".csv", ".json", ".jsonl", ".ndjson"].some((e) =>
        lower.endsWith(e),
      );
      if (!ingestible) continue;
      entries.push({ path: node.path, type: "file", size: node.size, ingestible: true });
      if (entries.length >= 200) break;
    }
    return { ref, entries };
  }

  const q = path
    ? `/repos/${opts.owner}/${opts.repo}/contents/${path}?ref=${encodeURIComponent(ref)}`
    : `/repos/${opts.owner}/${opts.repo}/contents?ref=${encodeURIComponent(ref)}`;
  const data = await ghFetch<
    | { type: string; path: string; size?: number; name: string }
    | Array<{ type: string; path: string; size?: number; name: string }>
  >(q, { token });
  const rows = Array.isArray(data) ? data : [data];
  const entries: GithubTreeEntry[] = rows.map((r) => {
    const lower = r.path.toLowerCase();
    const ingestible =
      r.type === "file" &&
      [".parquet", ".parq", ".csv", ".json", ".jsonl", ".ndjson"].some((e) => lower.endsWith(e));
    return {
      path: r.path,
      type: r.type === "dir" ? "dir" : "file",
      size: r.size,
      ingestible: r.type === "file" ? ingestible : undefined,
    };
  });
  return { ref, entries };
}

const BRIEF_CANDIDATES = ["TRAINFABRIC.md", "AGENTS.md", "AGENT.md"] as const;

/** Starter / empty briefs don't count — agent needs a real research goal. */
export function isPlaceholderResearchBrief(text: string): boolean {
  const t = text.trim();
  if (t.length < 48) return true;
  if (/Describe the research goal for this campaign/i.test(t)) return true;
  if (
    /Improve the target metric under the immutable eval protocol/i.test(t) &&
    t.length < 600
  ) {
    return true;
  }
  return false;
}

export type ResearchBriefInspection = {
  present: boolean;
  sourceFile?: string;
  preview?: string;
  isPlaceholder?: boolean;
};

/** Look for TRAINFABRIC.md / AGENTS.md (not README) and whether it's still the starter stub. */
export async function inspectInstallationResearchBrief(
  env: GithubAppEnv,
  installationId: number,
  opts: { owner: string; repo: string; ref?: string },
): Promise<ResearchBriefInspection> {
  const { token } = await createInstallationAccessToken(env, installationId);
  const ref = opts.ref || "main";
  for (const name of BRIEF_CANDIDATES) {
    try {
      const file = await ghFetch<{
        type?: string;
        encoding?: string;
        content?: string;
        size?: number;
      }>(
        `/repos/${opts.owner}/${opts.repo}/contents/${encodeURIComponent(name)}?ref=${encodeURIComponent(ref)}`,
        { token },
      );
      if (file.type && file.type !== "file") continue;
      let text = "";
      if (file.encoding === "base64" && file.content) {
        text = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ""))));
      }
      text = text.trim();
      if (!text) continue;
      const placeholder = isPlaceholderResearchBrief(text);
      return {
        present: !placeholder,
        sourceFile: name,
        preview: text.slice(0, 400),
        isPlaceholder: placeholder,
      };
    } catch {
      /* try next candidate */
    }
  }
  return { present: false };
}

/** Public-repo fallback (no installation) via anonymous Contents API. */
export async function inspectPublicResearchBrief(opts: {
  owner: string;
  repo: string;
  ref?: string;
}): Promise<ResearchBriefInspection> {
  const ref = opts.ref || "main";
  for (const name of BRIEF_CANDIDATES) {
    try {
      const res = await fetch(
        `${GH_API}/repos/${opts.owner}/${opts.repo}/contents/${encodeURIComponent(name)}?ref=${encodeURIComponent(ref)}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "trainfabric-router",
          },
        },
      );
      if (!res.ok) continue;
      const file = (await res.json()) as {
        type?: string;
        encoding?: string;
        content?: string;
      };
      if (file.type && file.type !== "file") continue;
      let text = "";
      if (file.encoding === "base64" && file.content) {
        text = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ""))));
      }
      text = text.trim();
      if (!text) continue;
      const placeholder = isPlaceholderResearchBrief(text);
      return {
        present: !placeholder,
        sourceFile: name,
        preview: text.slice(0, 400),
        isPlaceholder: placeholder,
      };
    } catch {
      /* next */
    }
  }
  return { present: false };
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
- Keep commits small; the Box autorunner pushes kept trials (and viz) to GitHub.
- Publish plots/summaries under \`artifacts/viz/\` (see official trainfabric skill).
- For GPU data: write \`artifacts/data_spec.json\` with an \`s3://\` lakehouse URI (Modal mounts R2 at \`/mnt/r2\`). Optional legacy: \`/r2/\` URL in \`artifacts/data_url.txt\`.
- Mutate agent uses Cloudflare AI Gateway (same as Hermes compute).
`,
  "protocol.yaml": `metric:
  name: val_bpb
  direction: min
budget:
  maxTrials: 20
  maxWallClockSec: 3600
mutablePaths:
  - train.py
  - artifacts/**
immutablePaths:
  - prepare.py
  - protocol.yaml
`,
  "artifacts/viz/README.md": `# Autoresearch visualizations

Plots and summaries published by the Box mutate agent land here and are pushed to this repo.
`,
  "artifacts/data_url.txt": `# optional legacy — TrainFabric /r2/ HTTPS URL (prefer data_spec.json)
`,
  // Keep in sync with services/autorunner/templates/{train,prepare}.py
  "train.py": `#!/usr/bin/env python3
"""GPU trial entrypoint — read lakehouse data from Modal CloudBucketMount (or legacy URL).

Preferred: artifacts/data_spec.json with an s3:// URI into the TrainFabric R2 warehouse.
Managed Modal mounts the bucket at TF_DATA_ROOT (/mnt/r2); this script reads TF_DATA_PATH.

Legacy: artifacts/data_url.txt with a TrainFabric Worker /r2/ HTTPS URL (small slices).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

DATA_SPEC_PATH = Path("artifacts/data_spec.json")
DATA_URL_PATH = Path("artifacts/data_url.txt")
RESOLVED_PATH = Path("artifacts/_tf_data_resolved.json")
DOWNLOAD_PATH = Path("artifacts/_tf_slice.bin")
METRICS_PATH = Path("metrics.json")
DEFAULT_HOSTS = frozenset({"trainfabric-router.rishabhspro.workers.dev"})
DEFAULT_MOUNT = "/mnt/r2"


def _api_hosts() -> set[str]:
    hosts = set(DEFAULT_HOSTS)
    for key in ("TRAINFABRIC_API_URL", "TF_API_URL"):
        raw = (os.environ.get(key) or "").strip()
        if not raw:
            continue
        try:
            host = urlparse(raw if "://" in raw else f"https://{raw}").hostname
        except Exception:
            host = None
        if host:
            hosts.add(host.lower())
    return hosts


def is_trainfabric_r2_url(url: str) -> bool:
    try:
        parsed = urlparse(url.strip())
    except Exception:
        return False
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    if host not in _api_hosts():
        return False
    path = parsed.path or ""
    return "/r2/" in path and not path.rstrip("/").endswith("/r2")


def _read_json(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def resolve_data_path() -> tuple[str, Path | None, str]:
    """Return (uri, local_path_or_none, source). Prefer mount over HTTP download."""
    # Injected by Modal after resolving data_spec
    env_path = (os.environ.get("TF_DATA_PATH") or "").strip()
    env_uri = (os.environ.get("TF_DATA_URI") or "").strip()
    if env_path and Path(env_path).exists():
        return env_uri or env_path, Path(env_path), "mount"

    resolved = _read_json(RESOLVED_PATH)
    if resolved:
        mp = resolved.get("mount_path")
        uri = str(resolved.get("uri") or "")
        if mp and Path(str(mp)).exists():
            return uri, Path(str(mp)), "mount"

    spec = _read_json(DATA_SPEC_PATH)
    if spec and spec.get("uri"):
        uri = str(spec["uri"]).strip()
        if uri.startswith("s3://"):
            # Map s3://bucket/key → /mnt/r2/key
            rest = uri[5:]
            key = rest.split("/", 1)[1] if "/" in rest else ""
            mount = (os.environ.get("TF_DATA_ROOT") or DEFAULT_MOUNT).rstrip("/")
            local = Path(f"{mount}/{key}") if key else Path(mount)
            if local.exists():
                return uri, local, "data_spec"
            return uri, local, "data_spec_missing"
        if is_trainfabric_r2_url(uri):
            return uri, None, "https"
        raise SystemExit(f"unsupported data_spec.uri: {uri}")

    if DATA_URL_PATH.is_file():
        for line in DATA_URL_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if not is_trainfabric_r2_url(line):
                raise SystemExit(
                    "refusing non-TrainFabric URL — use data_spec.json s3://… "
                    "or https://trainfabric-router…/r2/…"
                )
            return line, None, "data_url"

    raise SystemExit(
        "missing artifacts/data_spec.json (s3://…) or artifacts/data_url.txt (/r2/ URL)"
    )


def download_https(url: str, dest: Path = DOWNLOAD_PATH) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        url,
        headers={"Accept": "*/*", "User-Agent": "trainfabric-starter-train/2.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            # Stream to disk — do not buffer entire object in RAM
            with dest.open("wb") as out:
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"download failed HTTP {e.code}: {url}") from e
    except urllib.error.URLError as e:
        raise SystemExit(f"download failed: {e}") from e
    if not dest.exists() or dest.stat().st_size == 0:
        raise SystemExit("download returned empty body")
    return dest


def score_path(path: Path) -> tuple[float, int]:
    """Cheap stand-in metric (lower is better): size of file or directory tree."""
    if path.is_file():
        n = path.stat().st_size
        return float(n), n
    total = 0
    if path.is_dir():
        for root, _dirs, files in os.walk(path):
            for name in files:
                try:
                    total += (Path(root) / name).stat().st_size
                except OSError:
                    continue
    return float(total), total


def main() -> None:
    uri, local, source = resolve_data_path()
    if local is not None and local.exists():
        path = local
    elif source in {"https", "data_url"} or (uri.startswith("https://")):
        path = download_https(uri)
    else:
        raise SystemExit(
            f"data not found on mount ({local}) — ensure Modal CloudBucketMount "
            f"and data_spec.uri point at s3://{os.environ.get('R2_BUCKET', 'trainfabric-data')}/…"
        )

    score, nbytes = score_path(path)
    rank = os.environ.get("TF_CLUSTER_RANK", "0")
    # Non-zero cluster ranks may participate in real distributed train; starter
    # only rank 0 writes metrics (Modal callback also filters rank 0).
    if rank not in {"0", ""}:
        print(json.dumps({"ok": True, "rank": rank, "skipped_metrics": True}))
        return

    METRICS_PATH.write_text(
        json.dumps(
            {
                "score": score,
                "bytes": nbytes,
                "uri": uri,
                "path": str(path),
                "source": source,
                "tier": os.environ.get("TF_COMPUTE_TIER"),
            }
        )
        + "\\n",
        encoding="utf-8",
    )
    print(json.dumps({"ok": True, "score": score, "bytes": nbytes, "source": source}))


if __name__ == "__main__":
    main()
`,
  "prepare.py": `#!/usr/bin/env python3
"""Immutable prepare step for Trainfabric autoresearch campaigns.

Training data is **not** fetched here. The Box agent writes
\`artifacts/data_spec.json\` (s3:// lakehouse URI) or legacy
\`artifacts/data_url.txt\` (/r2/ URL). Managed Modal mounts R2 at /mnt/r2;
\`train.py\` reads TF_DATA_PATH at trial time.
"""

from __future__ import annotations


def main() -> None:
    print(
        "prepare.py: no-op — GPU data comes from artifacts/data_spec.json "
        "(s3:// on Modal CloudBucketMount) or artifacts/data_url.txt"
    )


if __name__ == "__main__":
    main()
`,
  "artifacts/data_spec.json": `{
  "uri": "s3://trainfabric-data/results/REPLACE_QUERY_HASH.parquet",
  "format": "parquet",
  "region": "auto"
}
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
artifacts/_tf_slice.bin
artifacts/_tf_data_resolved.json
metrics.json
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
    /**
     * Required for personal (User) accounts. GitHub rejects installation tokens on
     * POST /user/repos ("Resource not accessible by integration") — must use the
     * user-to-server OAuth token from Connect GitHub.
     */
    userAccessToken?: string;
  },
): Promise<GithubRepoSummary & { createdFromPlatform: true }> {
  const name = opts.name.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error("Invalid repo name — use letters, numbers, ., -, _");
  }
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

  let createToken: string;
  let createPath: string;
  if (opts.accountType === "Organization") {
    const { token } = await createInstallationAccessToken(env, opts.installationId);
    createToken = token;
    createPath = `/orgs/${opts.accountLogin}/repos`;
  } else {
    const userTok = opts.userAccessToken?.trim();
    if (!userTok) {
      throw new Error(
        "Reconnect GitHub (Connect) so we can create a personal repo. Admin on the App install alone cannot create repos under your user.",
      );
    }
    createToken = userTok;
    createPath = `/user/repos`;
  }

  let created: {
    id: number;
    full_name: string;
    name: string;
    private: boolean;
    default_branch: string;
    html_url: string;
    clone_url: string;
    description?: string | null;
  };
  try {
    created = await ghFetch<{
      id: number;
      full_name: string;
      name: string;
      private: boolean;
      default_branch: string;
      html_url: string;
      clone_url: string;
      description?: string | null;
    }>(createPath, { token: createToken, method: "POST", body });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/403|Resource not accessible by integration|not accessible/i.test(msg)) {
      throw new Error(
        opts.accountType === "Organization"
          ? "GitHub App needs Administration: Read and write on the org install to create repos. Update permissions on the App, then accept the request on GitHub."
          : "Cannot create a personal repo with the App install token. Reconnect GitHub so Trainfabric has your user OAuth token (Administration write on the App).",
      );
    }
    throw e;
  }

  const owner = created.full_name.split("/")[0]!;
  const repo = created.name;
  const branch = created.default_branch || defaultBranch;

  // Prefer the create token for seeding (user OAuth for personal; install token for orgs).
  for (const [path, content] of Object.entries(REPO_STARTER_FILES)) {
    await putFile(createToken, owner, repo, path, content, `Add ${path}`, branch);
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
