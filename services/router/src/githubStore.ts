/** GitHub App account + installation persistence (D1 or Convex HTTP). */

import { decryptSecret, encryptSecret } from "./githubCrypto";

export type GithubAccountRow = {
  userId: string;
  githubUserId: number;
  login: string;
  avatarUrl?: string;
  /** Encrypted user OAuth access token */
  userAccessTokenEnc: string;
  tokenExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type GithubInstallationRow = {
  installationId: number;
  userId: string;
  accountLogin: string;
  accountType: "User" | "Organization";
  accountId: number;
  avatarUrl?: string;
  suspended: boolean;
  createdAt: number;
  updatedAt: number;
};

export interface GithubStore {
  upsertAccount(row: GithubAccountRow): Promise<void>;
  getAccount(userId: string): Promise<GithubAccountRow | null>;
  deleteAccount(userId: string): Promise<void>;
  upsertInstallation(row: GithubInstallationRow): Promise<void>;
  listInstallations(userId: string): Promise<GithubInstallationRow[]>;
  getInstallation(installationId: number): Promise<GithubInstallationRow | null>;
  deleteInstallation(installationId: number): Promise<void>;
  deleteInstallationsForUser(userId: string): Promise<void>;
  setInstallationSuspended(installationId: number, suspended: boolean): Promise<void>;
}

async function ensureGithubSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS github_accounts (
        user_id TEXT PRIMARY KEY,
        github_user_id INTEGER NOT NULL,
        login TEXT NOT NULL,
        avatar_url TEXT,
        user_access_token_enc TEXT NOT NULL,
        token_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS github_installations (
        installation_id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        account_login TEXT NOT NULL,
        account_type TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        avatar_url TEXT,
        suspended INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_github_installations_user ON github_installations(user_id)`)
    .run();
}

function rowToAccount(r: Record<string, unknown>): GithubAccountRow {
  return {
    userId: String(r.user_id),
    githubUserId: Number(r.github_user_id),
    login: String(r.login),
    avatarUrl: r.avatar_url ? String(r.avatar_url) : undefined,
    userAccessTokenEnc: String(r.user_access_token_enc),
    tokenExpiresAt: r.token_expires_at != null ? Number(r.token_expires_at) : undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function rowToInstall(r: Record<string, unknown>): GithubInstallationRow {
  return {
    installationId: Number(r.installation_id),
    userId: String(r.user_id),
    accountLogin: String(r.account_login),
    accountType: r.account_type === "Organization" ? "Organization" : "User",
    accountId: Number(r.account_id),
    avatarUrl: r.avatar_url ? String(r.avatar_url) : undefined,
    suspended: Number(r.suspended) === 1,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function createD1GithubStore(db: D1Database): GithubStore {
  return {
    async upsertAccount(row) {
      await ensureGithubSchema(db);
      await db
        .prepare(
          `INSERT INTO github_accounts
            (user_id, github_user_id, login, avatar_url, user_access_token_enc, token_expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             github_user_id=excluded.github_user_id,
             login=excluded.login,
             avatar_url=excluded.avatar_url,
             user_access_token_enc=excluded.user_access_token_enc,
             token_expires_at=excluded.token_expires_at,
             updated_at=excluded.updated_at`,
        )
        .bind(
          row.userId,
          row.githubUserId,
          row.login,
          row.avatarUrl ?? null,
          row.userAccessTokenEnc,
          row.tokenExpiresAt ?? null,
          row.createdAt,
          row.updatedAt,
        )
        .run();
    },

    async getAccount(userId) {
      await ensureGithubSchema(db);
      const r = await db
        .prepare("SELECT * FROM github_accounts WHERE user_id = ?")
        .bind(userId)
        .first();
      return r ? rowToAccount(r as Record<string, unknown>) : null;
    },

    async deleteAccount(userId) {
      await ensureGithubSchema(db);
      await db.prepare("DELETE FROM github_accounts WHERE user_id = ?").bind(userId).run();
    },

    async upsertInstallation(row) {
      await ensureGithubSchema(db);
      await db
        .prepare(
          `INSERT INTO github_installations
            (installation_id, user_id, account_login, account_type, account_id, avatar_url, suspended, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(installation_id) DO UPDATE SET
             user_id=excluded.user_id,
             account_login=excluded.account_login,
             account_type=excluded.account_type,
             account_id=excluded.account_id,
             avatar_url=excluded.avatar_url,
             suspended=excluded.suspended,
             updated_at=excluded.updated_at`,
        )
        .bind(
          row.installationId,
          row.userId,
          row.accountLogin,
          row.accountType,
          row.accountId,
          row.avatarUrl ?? null,
          row.suspended ? 1 : 0,
          row.createdAt,
          row.updatedAt,
        )
        .run();
    },

    async listInstallations(userId) {
      await ensureGithubSchema(db);
      const { results } = await db
        .prepare(
          "SELECT * FROM github_installations WHERE user_id = ? ORDER BY account_login ASC",
        )
        .bind(userId)
        .all();
      return (results ?? []).map((r) => rowToInstall(r as Record<string, unknown>));
    },

    async getInstallation(installationId) {
      await ensureGithubSchema(db);
      const r = await db
        .prepare("SELECT * FROM github_installations WHERE installation_id = ?")
        .bind(installationId)
        .first();
      return r ? rowToInstall(r as Record<string, unknown>) : null;
    },

    async deleteInstallation(installationId) {
      await ensureGithubSchema(db);
      await db
        .prepare("DELETE FROM github_installations WHERE installation_id = ?")
        .bind(installationId)
        .run();
    },

    async deleteInstallationsForUser(userId) {
      await ensureGithubSchema(db);
      await db.prepare("DELETE FROM github_installations WHERE user_id = ?").bind(userId).run();
    },

    async setInstallationSuspended(installationId, suspended) {
      await ensureGithubSchema(db);
      await db
        .prepare(
          "UPDATE github_installations SET suspended = ?, updated_at = ? WHERE installation_id = ?",
        )
        .bind(suspended ? 1 : 0, Date.now(), installationId)
        .run();
    },
  };
}

function createConvexGithubStore(baseUrl: string, serviceKey: string): GithubStore {
  const headers = {
    "content-type": "application/json",
    "x-service-key": serviceKey,
  };
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Convex ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }

  return {
    upsertAccount: (row) => post("/api/github/accounts/upsert", row),
    getAccount: (userId) => post("/api/github/accounts/get", { userId }),
    deleteAccount: (userId) => post("/api/github/accounts/delete", { userId }),
    upsertInstallation: (row) => post("/api/github/installations/upsert", row),
    listInstallations: (userId) => post("/api/github/installations/list", { userId }),
    getInstallation: (installationId) =>
      post("/api/github/installations/get", { installationId }),
    deleteInstallation: (installationId) =>
      post("/api/github/installations/delete", { installationId }),
    deleteInstallationsForUser: (userId) =>
      post("/api/github/installations/delete-for-user", { userId }),
    setInstallationSuspended: (installationId, suspended) =>
      post("/api/github/installations/set-suspended", { installationId, suspended }),
  };
}

export function createGithubStore(env: {
  DB?: D1Database;
  CONVEX_URL?: string;
  CONVEX_SERVICE_KEY?: string;
}): GithubStore {
  if (env.DB) return createD1GithubStore(env.DB);
  if (!env.CONVEX_URL || !env.CONVEX_SERVICE_KEY) {
    throw new Error("Configure DB (D1) or CONVEX_URL + CONVEX_SERVICE_KEY");
  }
  return createConvexGithubStore(env.CONVEX_URL, env.CONVEX_SERVICE_KEY);
}

export async function encryptUserToken(token: string, cryptoKey: string): Promise<string> {
  return encryptSecret(token, cryptoKey);
}

export async function decryptUserToken(enc: string, cryptoKey: string): Promise<string> {
  return decryptSecret(enc, cryptoKey);
}

export function tokenCryptoKey(env: {
  GITHUB_TOKEN_CRYPTO_KEY?: string;
  GITHUB_APP_STATE_SECRET?: string;
  AGENT_TOKEN_SECRET?: string;
}): string {
  return (
    env.GITHUB_TOKEN_CRYPTO_KEY?.trim() ||
    env.GITHUB_APP_STATE_SECRET?.trim() ||
    env.AGENT_TOKEN_SECRET?.trim() ||
    "dev-github-token-crypto"
  );
}
