/** Social feed, connections, and notifications — D1 + Convex backends. */

import type {
  AppNotification,
  ConnectionSource,
  DatasetConnection,
  SocialPost,
  SocialPostSource,
} from "@trainfabric/shared";

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

export interface SocialStore {
  ensureConnection(
    userId: string,
    datasetId: string,
    source: ConnectionSource,
  ): Promise<{ connected: true; created: boolean; source: ConnectionSource }>;
  toggleConnection(
    userId: string,
    datasetId: string,
    source?: ConnectionSource,
  ): Promise<{ connected: boolean }>;
  getConnection(userId: string, datasetId: string): Promise<DatasetConnection | null>;
  listConnections(userId: string): Promise<DatasetConnection[]>;
  createPost(input: {
    authorId: string;
    authorName?: string;
    datasetId: string;
    body: string;
    source: SocialPostSource;
    findings?: Record<string, unknown>;
    datasetOwner?: string;
    datasetName?: string;
  }): Promise<SocialPost>;
  getPost(postId: string): Promise<SocialPost | null>;
  listFeed(opts: {
    userId?: string;
    datasetId?: string;
    limit?: number;
  }): Promise<SocialPost[]>;
  listNotifications(userId: string, limit?: number): Promise<AppNotification[]>;
  markNotificationRead(userId: string, notificationId: string): Promise<{ ok: boolean }>;
  markAllNotificationsRead(userId: string): Promise<{ ok: boolean; count: number }>;
}

async function ensureSocialSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS connections (
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, dataset_id)
      )`,
    )
    .run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(user_id)`).run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_connections_dataset ON connections(dataset_id)`)
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS social_posts (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL,
        author_name TEXT,
        dataset_id TEXT NOT NULL,
        body TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        findings_json TEXT,
        created_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_social_posts_dataset ON social_posts(dataset_id)`)
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts(created_at DESC)`)
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        href TEXT,
        post_id TEXT,
        dataset_id TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)`)
    .run();
}

function rowToConnection(r: Record<string, unknown>): DatasetConnection {
  return {
    userId: String(r.user_id),
    datasetId: String(r.dataset_id),
    source: String(r.source) as ConnectionSource,
    createdAt: Number(r.created_at),
  };
}

function rowToPost(
  r: Record<string, unknown>,
  meta?: { owner?: string; name?: string },
): SocialPost {
  return {
    id: String(r.id),
    authorId: String(r.author_id),
    authorName: r.author_name ? String(r.author_name) : undefined,
    datasetId: String(r.dataset_id),
    datasetOwner: meta?.owner,
    datasetName: meta?.name,
    body: String(r.body),
    source: String(r.source) as SocialPostSource,
    findings: r.findings_json ? JSON.parse(String(r.findings_json)) : undefined,
    createdAt: Number(r.created_at),
  };
}

function rowToNotification(r: Record<string, unknown>): AppNotification {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    kind: String(r.kind) as AppNotification["kind"],
    title: String(r.title),
    body: String(r.body),
    href: r.href ? String(r.href) : undefined,
    postId: r.post_id ? String(r.post_id) : undefined,
    datasetId: r.dataset_id ? String(r.dataset_id) : undefined,
    read: Boolean(r.read),
    createdAt: Number(r.created_at),
  };
}

async function datasetMeta(
  db: D1Database,
  datasetId: string,
): Promise<{ owner?: string; name?: string }> {
  const row = await db
    .prepare("SELECT owner, name FROM datasets WHERE id = ?")
    .bind(datasetId)
    .first<{ owner: string; name: string }>();
  return row ? { owner: row.owner, name: row.name } : {};
}

export function createD1SocialStore(db: D1Database): SocialStore {
  return {
    async ensureConnection(userId, datasetId, source) {
      await ensureSocialSchema(db);
      const existing = await db
        .prepare("SELECT source FROM connections WHERE user_id = ? AND dataset_id = ?")
        .bind(userId, datasetId)
        .first<{ source: string }>();
      if (existing) {
        return {
          connected: true,
          created: false,
          source: existing.source as ConnectionSource,
        };
      }
      await db
        .prepare(
          "INSERT INTO connections (user_id, dataset_id, source, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(userId, datasetId, source, Date.now())
        .run();
      return { connected: true, created: true, source };
    },

    async toggleConnection(userId, datasetId, source = "manual") {
      await ensureSocialSchema(db);
      const existing = await db
        .prepare("SELECT user_id FROM connections WHERE user_id = ? AND dataset_id = ?")
        .bind(userId, datasetId)
        .first();
      if (existing) {
        await db
          .prepare("DELETE FROM connections WHERE user_id = ? AND dataset_id = ?")
          .bind(userId, datasetId)
          .run();
        return { connected: false };
      }
      await db
        .prepare(
          "INSERT INTO connections (user_id, dataset_id, source, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(userId, datasetId, source, Date.now())
        .run();
      return { connected: true };
    },

    async getConnection(userId, datasetId) {
      await ensureSocialSchema(db);
      const row = await db
        .prepare("SELECT * FROM connections WHERE user_id = ? AND dataset_id = ?")
        .bind(userId, datasetId)
        .first();
      return row ? rowToConnection(row as Record<string, unknown>) : null;
    },

    async listConnections(userId) {
      await ensureSocialSchema(db);
      const rows = await db
        .prepare("SELECT * FROM connections WHERE user_id = ? ORDER BY created_at DESC")
        .bind(userId)
        .all();
      return (rows.results ?? []).map((r) => rowToConnection(r as Record<string, unknown>));
    },

    async createPost(input) {
      await ensureSocialSchema(db);
      const id = newId("post");
      const createdAt = Date.now();
      await db
        .prepare(
          `INSERT INTO social_posts
          (id, author_id, author_name, dataset_id, body, source, findings_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.authorId,
          input.authorName ?? null,
          input.datasetId,
          input.body,
          input.source,
          input.findings ? JSON.stringify(input.findings) : null,
          createdAt,
        )
        .run();

      const meta =
        input.datasetOwner && input.datasetName
          ? { owner: input.datasetOwner, name: input.datasetName }
          : await datasetMeta(db, input.datasetId);
      const label = meta.owner && meta.name ? `${meta.owner}/${meta.name}` : input.datasetId;
      const who =
        input.authorName || (input.source === "agent" ? "an agent" : "someone");

      const connected = await db
        .prepare("SELECT user_id FROM connections WHERE dataset_id = ?")
        .bind(input.datasetId)
        .all<{ user_id: string }>();
      for (const c of connected.results ?? []) {
        if (c.user_id === input.authorId) continue;
        await db
          .prepare(
            `INSERT INTO notifications
            (id, user_id, kind, title, body, href, post_id, dataset_id, read, created_at)
            VALUES (?, ?, 'social_post', ?, ?, ?, ?, ?, 0, ?)`,
          )
          .bind(
            newId("nt"),
            c.user_id,
            `Update on ${label}`,
            `${who}: ${input.body.slice(0, 140)}`,
            `/posts/${id}`,
            id,
            input.datasetId,
            createdAt,
          )
          .run();
      }

      return {
        id,
        authorId: input.authorId,
        authorName: input.authorName,
        datasetId: input.datasetId,
        datasetOwner: meta.owner,
        datasetName: meta.name,
        body: input.body,
        source: input.source,
        findings: input.findings,
        createdAt,
      };
    },

    async getPost(postId) {
      await ensureSocialSchema(db);
      const row = await db.prepare("SELECT * FROM social_posts WHERE id = ?").bind(postId).first();
      if (!row) return null;
      const meta = await datasetMeta(db, String((row as { dataset_id: string }).dataset_id));
      return rowToPost(row as Record<string, unknown>, meta);
    },

    async listFeed(opts) {
      await ensureSocialSchema(db);
      const limit = opts.limit ?? 40;
      let datasetIds: string[] | null = null;
      if (opts.datasetId) {
        datasetIds = [opts.datasetId];
      } else if (opts.userId) {
        const conns = await db
          .prepare("SELECT dataset_id FROM connections WHERE user_id = ?")
          .bind(opts.userId)
          .all<{ dataset_id: string }>();
        datasetIds = (conns.results ?? []).map((c) => c.dataset_id);
        if (datasetIds.length === 0) {
          // No connections yet — show global public feed so home isn't empty.
          datasetIds = null;
        }
      }

      let rows: Record<string, unknown>[];
      if (datasetIds === null) {
        const res = await db
          .prepare("SELECT * FROM social_posts ORDER BY created_at DESC LIMIT ?")
          .bind(limit)
          .all();
        rows = (res.results ?? []) as Record<string, unknown>[];
      } else if (datasetIds.length === 0) {
        return [];
      } else {
        const placeholders = datasetIds.map(() => "?").join(",");
        const res = await db
          .prepare(
            `SELECT * FROM social_posts WHERE dataset_id IN (${placeholders})
             ORDER BY created_at DESC LIMIT ?`,
          )
          .bind(...datasetIds, limit)
          .all();
        rows = (res.results ?? []) as Record<string, unknown>[];
      }

      const out: SocialPost[] = [];
      for (const r of rows) {
        const meta = await datasetMeta(db, String(r.dataset_id));
        out.push(rowToPost(r, meta));
      }
      return out;
    },

    async listNotifications(userId, limit = 50) {
      await ensureSocialSchema(db);
      const rows = await db
        .prepare(
          "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(userId, limit)
        .all();
      return (rows.results ?? []).map((r) => rowToNotification(r as Record<string, unknown>));
    },

    async markNotificationRead(userId, notificationId) {
      await ensureSocialSchema(db);
      const res = await db
        .prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?")
        .bind(notificationId, userId)
        .run();
      return { ok: (res.meta?.changes ?? 0) > 0 };
    },

    async markAllNotificationsRead(userId) {
      await ensureSocialSchema(db);
      const res = await db
        .prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0")
        .bind(userId)
        .run();
      return { ok: true, count: res.meta?.changes ?? 0 };
    },
  };
}

/** Convex HTTP-backed social store (service key). */
export function createConvexSocialStore(
  baseUrl: string,
  serviceKey: string,
): SocialStore {
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
    return res.json() as Promise<T>;
  }

  return {
    ensureConnection: (userId, datasetId, source) =>
      post("/api/social/ensure-connection", { userId, datasetId, source }),
    toggleConnection: (userId, datasetId, source) =>
      post("/api/social/toggle-connection", { userId, datasetId, source }),
    getConnection: (userId, datasetId) =>
      post("/api/social/get-connection", { userId, datasetId }),
    listConnections: (userId) => post("/api/social/list-connections", { userId }),
    createPost: async (input) => {
      const postId = newId("post");
      return post("/api/social/create-post", { postId, ...input });
    },
    getPost: (postId) => post("/api/social/get-post", { postId }),
    listFeed: (opts) => post("/api/social/list-feed", opts),
    listNotifications: (userId, limit) =>
      post("/api/social/list-notifications", { userId, limit }),
    markNotificationRead: (userId, notificationId) =>
      post("/api/social/mark-read", { userId, notificationId }),
    markAllNotificationsRead: (userId) =>
      post("/api/social/mark-all-read", { userId }),
  };
}

export function createSocialStore(env: {
  DB?: D1Database;
  CONVEX_URL?: string;
  CONVEX_SERVICE_KEY?: string;
}): SocialStore | null {
  if (env.DB) return createD1SocialStore(env.DB);
  if (env.CONVEX_URL && env.CONVEX_SERVICE_KEY) {
    return createConvexSocialStore(env.CONVEX_URL, env.CONVEX_SERVICE_KEY);
  }
  return null;
}

/** Fire-and-forget auto-connect after query/sample/agent use. */
export async function autoConnect(
  store: SocialStore | null,
  userId: string | undefined | null,
  datasetId: string,
  source: ConnectionSource,
): Promise<void> {
  if (!store || !userId || userId === "anon") return;
  try {
    await store.ensureConnection(userId, datasetId, source);
  } catch {
    /* non-fatal */
  }
}
