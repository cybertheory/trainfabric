/** Hugging Face OAuth account persistence (D1 or Convex HTTP). */

import { decryptSecret, encryptSecret } from "./githubCrypto";

export type HfAccountRow = {
  userId: string;
  hfSub: string;
  login: string;
  avatarUrl?: string;
  /** Encrypted HF OAuth access token */
  accessTokenEnc: string;
  refreshTokenEnc?: string;
  tokenExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
};

export interface HfStore {
  upsertAccount(row: HfAccountRow): Promise<void>;
  getAccount(userId: string): Promise<HfAccountRow | null>;
  deleteAccount(userId: string): Promise<void>;
}

async function ensureHfSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS hf_accounts (
        user_id TEXT PRIMARY KEY,
        hf_sub TEXT NOT NULL,
        login TEXT NOT NULL,
        avatar_url TEXT,
        access_token_enc TEXT NOT NULL,
        refresh_token_enc TEXT,
        token_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();
}

function rowToAccount(r: Record<string, unknown>): HfAccountRow {
  return {
    userId: String(r.user_id),
    hfSub: String(r.hf_sub),
    login: String(r.login),
    avatarUrl: r.avatar_url ? String(r.avatar_url) : undefined,
    accessTokenEnc: String(r.access_token_enc),
    refreshTokenEnc: r.refresh_token_enc ? String(r.refresh_token_enc) : undefined,
    tokenExpiresAt: r.token_expires_at != null ? Number(r.token_expires_at) : undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function createD1HfStore(db: D1Database): HfStore {
  return {
    async upsertAccount(row) {
      await ensureHfSchema(db);
      await db
        .prepare(
          `INSERT INTO hf_accounts
            (user_id, hf_sub, login, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             hf_sub=excluded.hf_sub,
             login=excluded.login,
             avatar_url=excluded.avatar_url,
             access_token_enc=excluded.access_token_enc,
             refresh_token_enc=excluded.refresh_token_enc,
             token_expires_at=excluded.token_expires_at,
             updated_at=excluded.updated_at`,
        )
        .bind(
          row.userId,
          row.hfSub,
          row.login,
          row.avatarUrl ?? null,
          row.accessTokenEnc,
          row.refreshTokenEnc ?? null,
          row.tokenExpiresAt ?? null,
          row.createdAt,
          row.updatedAt,
        )
        .run();
    },
    async getAccount(userId) {
      await ensureHfSchema(db);
      const r = await db
        .prepare("SELECT * FROM hf_accounts WHERE user_id = ?")
        .bind(userId)
        .first();
      return r ? rowToAccount(r as Record<string, unknown>) : null;
    },
    async deleteAccount(userId) {
      await ensureHfSchema(db);
      await db.prepare("DELETE FROM hf_accounts WHERE user_id = ?").bind(userId).run();
    },
  };
}


export function createHfStore(env: { DB?: D1Database }): HfStore {
  if (!env.DB) {
    throw new Error('Configure DB (D1) on the Worker');
  }
  return createD1HfStore(env.DB);
}


export async function encryptHfToken(token: string, cryptoKey: string): Promise<string> {
  return encryptSecret(token, cryptoKey);
}

export async function decryptHfToken(enc: string, cryptoKey: string): Promise<string> {
  return decryptSecret(enc, cryptoKey);
}
