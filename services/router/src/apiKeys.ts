/**
 * Trainfabric-native API keys (tfak_*) — fallback when Clerk user API keys
 * are unavailable, plus device-authorization (RFC 8628-style) state.
 */

import type { Identity } from "./resolver";

export type DeviceAuthStatus = "pending" | "approved" | "denied" | "expired";

export interface DeviceAuthRow {
  device_code: string;
  user_code: string;
  status: DeviceAuthStatus;
  user_id: string | null;
  access_token: string | null;
  token_type: string | null;
  client_name: string | null;
  created_at: number;
  expires_at: number;
  approved_at: number | null;
}

export interface TfApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  prefix: string;
  scopes: string;
  created_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomUserCode(): string {
  // XXXX-XXXX — easy to type from a second device
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () => alphabet[crypto.getRandomValues(new Uint8Array(1))[0]! % alphabet.length]!;
  return `${Array.from({ length: 4 }, pick).join("")}-${Array.from({ length: 4 }, pick).join("")}`;
}

async function sha256Hex(value: string): Promise<string> {
  const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createApiKeyStore(db: D1Database | undefined) {
  if (!db) return null;

  let ready: Promise<void> | null = null;
  function ensure(): Promise<void> {
    if (!ready) {
      ready = (async () => {
        await db
          .prepare(
            `CREATE TABLE IF NOT EXISTS device_auth (
              device_code TEXT PRIMARY KEY,
              user_code TEXT NOT NULL UNIQUE,
              status TEXT NOT NULL,
              user_id TEXT,
              access_token TEXT,
              token_type TEXT,
              client_name TEXT,
              created_at INTEGER NOT NULL,
              expires_at INTEGER NOT NULL,
              approved_at INTEGER
            )`,
          )
          .run();
        await db
          .prepare(`CREATE INDEX IF NOT EXISTS idx_device_auth_user_code ON device_auth(user_code)`)
          .run();
        await db
          .prepare(
            `CREATE TABLE IF NOT EXISTS tf_api_keys (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              name TEXT NOT NULL,
              token_hash TEXT NOT NULL UNIQUE,
              prefix TEXT NOT NULL,
              scopes TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              revoked_at INTEGER,
              last_used_at INTEGER
            )`,
          )
          .run();
        await db
          .prepare(`CREATE INDEX IF NOT EXISTS idx_tf_api_keys_user ON tf_api_keys(user_id)`)
          .run();
      })();
    }
    return ready;
  }

  return {
    async startDevice(opts: {
      clientName?: string;
      expiresInSec?: number;
    }): Promise<{
      deviceCode: string;
      userCode: string;
      expiresIn: number;
      interval: number;
    }> {
      await ensure();
      const expiresIn = opts.expiresInSec ?? 900;
      const now = Date.now();
      const deviceCode = `dc_${randomHex(24)}`;
      let userCode = randomUserCode();
      for (let i = 0; i < 5; i++) {
        try {
          await db
            .prepare(
              `INSERT INTO device_auth
                (device_code, user_code, status, user_id, access_token, token_type, client_name, created_at, expires_at, approved_at)
               VALUES (?, ?, 'pending', NULL, NULL, NULL, ?, ?, ?, NULL)`,
            )
            .bind(deviceCode, userCode, opts.clientName ?? null, now, now + expiresIn * 1000)
            .run();
          return { deviceCode, userCode, expiresIn, interval: 5 };
        } catch {
          userCode = randomUserCode();
        }
      }
      throw new Error("Failed to allocate device user code");
    },

    async getByDeviceCode(deviceCode: string): Promise<DeviceAuthRow | null> {
      await ensure();
      return (
        (await db
          .prepare("SELECT * FROM device_auth WHERE device_code = ?")
          .bind(deviceCode)
          .first<DeviceAuthRow>()) ?? null
      );
    },

    async getByUserCode(userCode: string): Promise<DeviceAuthRow | null> {
      await ensure();
      const normalized = userCode.trim().toUpperCase().replace(/\s+/g, "");
      return (
        (await db
          .prepare("SELECT * FROM device_auth WHERE upper(replace(user_code, ' ', '')) = ?")
          .bind(normalized)
          .first<DeviceAuthRow>()) ?? null
      );
    },

    async approve(
      userCode: string,
      opts: { userId: string; accessToken: string; tokenType: string },
    ): Promise<DeviceAuthRow | null> {
      await ensure();
      const row = await this.getByUserCode(userCode);
      if (!row) return null;
      if (row.status !== "pending") return row;
      if (Date.now() > row.expires_at) {
        await db
          .prepare("UPDATE device_auth SET status = 'expired' WHERE device_code = ?")
          .bind(row.device_code)
          .run();
        return { ...row, status: "expired" };
      }
      const now = Date.now();
      await db
        .prepare(
          `UPDATE device_auth
           SET status = 'approved', user_id = ?, access_token = ?, token_type = ?, approved_at = ?
           WHERE device_code = ? AND status = 'pending'`,
        )
        .bind(opts.userId, opts.accessToken, opts.tokenType, now, row.device_code)
        .run();
      return {
        ...row,
        status: "approved",
        user_id: opts.userId,
        access_token: opts.accessToken,
        token_type: opts.tokenType,
        approved_at: now,
      };
    },

    async deny(userCode: string): Promise<boolean> {
      await ensure();
      const row = await this.getByUserCode(userCode);
      if (!row || row.status !== "pending") return false;
      await db
        .prepare("UPDATE device_auth SET status = 'denied' WHERE device_code = ?")
        .bind(row.device_code)
        .run();
      return true;
    },

    /** Consume the one-time access token after a successful poll. */
    async consumeAccessToken(deviceCode: string): Promise<string | null> {
      await ensure();
      const row = await this.getByDeviceCode(deviceCode);
      if (!row || row.status !== "approved" || !row.access_token) return null;
      const token = row.access_token;
      await db
        .prepare("UPDATE device_auth SET access_token = NULL WHERE device_code = ?")
        .bind(deviceCode)
        .run();
      return token;
    },

    async createTfApiKey(opts: {
      userId: string;
      name: string;
      scopes?: string[];
    }): Promise<{ id: string; secret: string; prefix: string }> {
      await ensure();
      const id = `tfk_${randomHex(12)}`;
      const secret = `tfak_${randomHex(24)}`;
      const tokenHash = await sha256Hex(secret);
      const prefix = secret.slice(0, 12);
      const now = Date.now();
      await db
        .prepare(
          `INSERT INTO tf_api_keys
            (id, user_id, name, token_hash, prefix, scopes, created_at, revoked_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        )
        .bind(
          id,
          opts.userId,
          opts.name,
          tokenHash,
          prefix,
          JSON.stringify(opts.scopes ?? ["trainfabric"]),
          now,
        )
        .run();
      return { id, secret, prefix };
    },

    async verifyTfApiKey(
      authHeader: string | null | undefined,
    ): Promise<(Identity & { apiKeyId: string; scopes: string[] }) | null> {
      if (!authHeader?.startsWith("Bearer ")) return null;
      const secret = authHeader.slice(7).trim();
      if (!secret.startsWith("tfak_")) return null;
      await ensure();
      const tokenHash = await sha256Hex(secret);
      const row = await db
        .prepare("SELECT * FROM tf_api_keys WHERE token_hash = ?")
        .bind(tokenHash)
        .first<TfApiKeyRow>();
      if (!row || row.revoked_at) return null;
      await db
        .prepare("UPDATE tf_api_keys SET last_used_at = ? WHERE id = ?")
        .bind(Date.now(), row.id)
        .run();
      let scopes: string[] = [];
      try {
        scopes = JSON.parse(row.scopes) as string[];
      } catch {
        scopes = [];
      }
      return { subject: row.user_id, apiKeyId: row.id, scopes };
    },

    async listTfApiKeys(userId: string): Promise<
      Array<{
        id: string;
        name: string;
        prefix: string;
        scopes: string[];
        createdAt: number;
        revokedAt: number | null;
        lastUsedAt: number | null;
      }>
    > {
      await ensure();
      const res = await db
        .prepare(
          `SELECT id, name, prefix, scopes, created_at, revoked_at, last_used_at
           FROM tf_api_keys WHERE user_id = ? ORDER BY created_at DESC`,
        )
        .bind(userId)
        .all<TfApiKeyRow>();
      return (res.results ?? []).map((r) => {
        let scopes: string[] = [];
        try {
          scopes = JSON.parse(r.scopes) as string[];
        } catch {
          scopes = [];
        }
        return {
          id: r.id,
          name: r.name,
          prefix: r.prefix,
          scopes,
          createdAt: r.created_at,
          revokedAt: r.revoked_at,
          lastUsedAt: r.last_used_at,
        };
      });
    },

    async revokeTfApiKey(userId: string, keyId: string): Promise<boolean> {
      await ensure();
      const res = await db
        .prepare(
          `UPDATE tf_api_keys SET revoked_at = ?
           WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        )
        .bind(Date.now(), keyId, userId)
        .run();
      return (res.meta?.changes ?? 0) > 0;
    },
  };
}

export type ApiKeyStore = NonNullable<ReturnType<typeof createApiKeyStore>>;
