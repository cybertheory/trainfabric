import { Hono } from "hono";
import { cors } from "hono/cors";
import type { QueryRequest, Visibility } from "@trainfabric/shared";
import {
  resolveQuery,
  authorizeDataset,
  AuthError,
  NotFoundError,
  FilterValidationError,
  type DatasetRecord,
  type Identity,
  type ResolverDeps,
} from "./resolver";
import { createRegistry } from "./registry";
import { createD1Registry } from "./d1";
import {
  createComputeClientFromEnv,
  CONTAINER_COMPUTE,
} from "./compute";
import type { ComputeContainer } from "./ComputeContainer";
import { verifyClerkJwt } from "./auth";
import { mintAgentToken, verifyAgentToken, agentHasReadScope } from "./agentToken";
import { publicResultUrl, putStaging, objectKeyFromUri } from "./r2";
import {
  parseSourceUrl,
  listRemoteFiles,
  downloadRemoteToR2,
  RemoteSourceError,
} from "./remoteSource";
import { type McpContext } from "./mcp";
import { handleTrainfabricMcp } from "./mcpHttp";
import { decideMaterialization, detectCycle, visibilityAllowed } from "./derived";
import { upsertDatasetEmbedding } from "./discover";
import { CatalogDO } from "./CatalogDO";
import { WarmRouterDO } from "./WarmRouterDO";
import { ComputeContainer as ComputeContainerClass } from "./ComputeContainer";
import { autoConnect, createSocialStore } from "./social";
import type {
  BindAutoDatasetRequest,
  CompleteAutoTrialRequest,
  CreateAutoRunRequest,
  CreateSocialPostRequest,
  PostAutoMessageRequest,
  RegisterRunnerRequest,
  ReportAutoInstructionsRequest,
} from "@trainfabric/shared";
import { createAutoStore } from "./autoStore";
import { boxClientFromEnv } from "./box";
import {
  authRunner,
  bindDataset,
  cancelAutoRun,
  completeTrial,
  createAutoRun,
  enqueueTrial,
  logActivity,
  pauseAutoRun,
  postAutoMessage,
  registerRunner,
  reportInstructions,
  resumeAutoRun,
} from "./auto";

export { CatalogDO, WarmRouterDO, ComputeContainerClass as ComputeContainer };

export interface Env {
  R2: R2Bucket;
  DB?: D1Database;
  CATALOG_DO: DurableObjectNamespace;
  WARM_ROUTER_DO: DurableObjectNamespace;
  COMPUTE?: DurableObjectNamespace<ComputeContainer>;
  VECTORIZE?: VectorizeIndex;
  AI?: Ai;
  CONVEX_URL?: string;
  CONVEX_SERVICE_KEY?: string;
  COMPUTE_URL?: string;
  CLERK_JWT_ISSUER?: string;
  CLERK_JWT_AUDIENCE?: string;
  STREAM_SIZE_THRESHOLD_BYTES?: string;
  R2_PUBLIC_BASE?: string;
  ENABLE_BRANCHING?: string;
  CASE_A_MODE?: string;
  WARM_HOT_THRESHOLD?: string;
  WARM_IDLE_TIMEOUT_MS?: string;
  CATALOG_BACKEND?: string;
  ICEBERG_CATALOG_URI?: string;
  ICEBERG_WAREHOUSE?: string;
  ICEBERG_WAREHOUSE_ID?: string;
  ICEBERG_REST_URI?: string;
  ICEBERG_TOKEN?: string;
  R2_ENDPOINT?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  R2_REGION?: string;
  /** Public Vercel dashboard URL — non-API paths redirect here when set. */
  DASHBOARD_URL?: string;
  /** Cloudflare AI Gateway (forwarded into compute for Hermes). */
  CF_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_ID?: string;
  CF_AI_GATEWAY_TOKEN?: string;
  CF_AI_GATEWAY_BASE?: string;
  CF_AI_MODEL?: string;
  /** Box by ASCII — long-running /auto agent sandboxes */
  BOX_API_KEY?: string;
  BOX_TEMPLATE_ID?: string;
  BOX_API_BASE?: string;
  /** Modal GPU trials */
  MODAL_TOKEN?: string;
  MODAL_APP_REF?: string;
  MODAL_API_BASE?: string;
  /** Public router origin for trial callbacks / Box env */
  PUBLIC_API_URL?: string;
  /** Public API base for Hermes tf CLI (same origin as this Worker). */
  PUBLIC_API_BASE?: string;
  /** HS256 secret for short-lived Hermes agent tokens. */
  AGENT_TOKEN_SECRET?: string;
}

function computeUrlFor(env: Env): string {
  // Prefer explicit HTTP compute (local/tunnel) so we can bypass container image rollout.
  if (env.COMPUTE_URL) return env.COMPUTE_URL;
  return env.COMPUTE ? CONTAINER_COMPUTE : "";
}

function identityOrAnon(
  identity: Identity | null,
  env: Env,
): Identity | null {
  if (identity) return identity;
  if (!env.CLERK_JWT_ISSUER) return { subject: "anon" };
  return null;
}

type Variables = { identity: Identity | null; authVia: "clerk" | "agent" | null };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Accept",
      "Mcp-Session-Id",
      "Last-Event-ID",
    ],
    exposeHeaders: ["Mcp-Session-Id"],
  }),
);

app.use("*", async (c, next) => {
  const auth = c.req.header("Authorization");
  let identity = await verifyClerkJwt(auth, {
    CLERK_JWT_ISSUER: c.env.CLERK_JWT_ISSUER,
    CLERK_JWT_AUDIENCE: c.env.CLERK_JWT_AUDIENCE,
  });
  let authVia: "clerk" | "agent" | null = identity ? "clerk" : null;
  if (!identity) {
    const agent = await verifyAgentToken(auth, c.env.AGENT_TOKEN_SECRET);
    if (agent && agentHasReadScope(agent.scope)) {
      identity = { subject: agent.subject, email: agent.email };
      authVia = "agent";
    }
  }
  c.set("identity", identity);
  c.set("authVia", authVia);
  await next();
});

function requireClerkIdentity(c: { get: (k: "identity" | "authVia") => Identity | null | "clerk" | "agent" | null; env: Env }) {
  const identity = identityOrAnon(c.get("identity") as Identity | null, c.env);
  if (!identity) return { error: "Unauthorized" as const, status: 401 as const };
  if (c.get("authVia") === "agent") {
    return { error: "Agent tokens are read-only; use a Clerk session for writes" as const, status: 403 as const };
  }
  return { identity };
}

function depsFrom(c: { env: Env; req: { url: string } }): ResolverDeps {
  const registry = createRegistry(c.env);
  const hasCompute = Boolean(c.env.COMPUTE || c.env.COMPUTE_URL);
  const compute = hasCompute ? createComputeClientFromEnv(c.env) : null;
  const base = new URL(c.req.url).origin;

  async function demoPlan(datasetId: string) {
    const ds = (await registry.getDataset(datasetId)) as DatasetRecord | null;
    if (!ds) throw new Error("dataset missing");
    return {
      case: "B" as const,
      matchedFiles: [] as string[],
      estimatedRows: ds.rowCount,
      estimatedBytes: ds.sizeBytes,
      reason: "demo metadata (compute not configured)",
      partitionColumns: ds.schema?.partitionColumns ?? [],
    };
  }

  return {
    getDataset: async (id) => (await registry.getDataset(id)) as DatasetRecord | null,
    lookupCache: async (queryHash) =>
      (await registry.lookupCache(queryHash)) as ResolverDeps["lookupCache"] extends (
        ...a: infer _
      ) => Promise<infer R>
        ? R
        : never,
    upsertCache: async (entry) => {
      await registry.upsertCache(entry);
    },
    scanPlan: async (req) => {
      if (!compute) return demoPlan(req.datasetId);
      try {
        return await compute.scanPlan(req);
      } catch {
        return demoPlan(req.datasetId);
      }
    },
    query: async (req) => {
      if (compute) {
        try {
          return await compute.query(req);
        } catch {
          /* fall through to demo */
        }
      }
      const ds = (await registry.getDataset(req.datasetId)) as DatasetRecord | null;
      const rows = ds?.schema?.sampleRows ?? [];
      const payload = JSON.stringify(rows);
      return {
        mode: "stream" as const,
        arrowBase64: btoa(payload),
        rowCount: rows.length || ds?.rowCount || 0,
        sizeBytes: payload.length || ds?.sizeBytes || 0,
      };
    },
    presign: async (r2Url) => publicResultUrl(c.env.R2_PUBLIC_BASE || base, r2Url),
  };
}

function errResponse(e: unknown): Response {
  if (e instanceof AuthError) return Response.json({ error: e.message }, { status: 403 });
  if (e instanceof NotFoundError) return Response.json({ error: e.message }, { status: 404 });
  if (e instanceof FilterValidationError)
    return Response.json({ error: e.message }, { status: 400 });
  const msg = e instanceof Error ? e.message : String(e);
  return Response.json({ error: msg }, { status: 500 });
}

/**
 * Emit a Vercel AI SDK UI message stream (v5 SSE protocol) for `useChat`.
 * Chunks the assistant reply into text-deltas so the client renders progressively.
 */
function streamAiMessage(messageId: string, text: string): Response {
  const encoder = new TextEncoder();
  const send = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(send({ type: "start" }));
      controller.enqueue(send({ type: "text-start", id: messageId }));
      const words = text.split(/(\s+)/);
      for (const w of words) {
        if (w) controller.enqueue(send({ type: "text-delta", id: messageId, delta: w }));
      }
      controller.enqueue(send({ type: "text-end", id: messageId }));
      controller.enqueue(send({ type: "finish" }));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}

app.get("/health", (c) =>
  c.json({
    status: "ok",
    registry: c.env.DB ? "d1" : "convex",
    compute: c.env.COMPUTE_URL ? "http" : c.env.COMPUTE ? "container" : "none",
  }),
);

/** Identity echo for tf whoami (Clerk session or agent token). */
app.get("/auth/whoami", (c) => {
  const identity = identityOrAnon(c.get("identity"), c.env);
  if (!identity) return c.json({ error: "Unauthorized" }, 401);
  return c.json({
    subject: identity.subject,
    email: identity.email ?? null,
    authVia: c.get("authVia") ?? (identity.subject === "anon" ? "anon" : null),
  });
});

app.post("/admin/seed", async (c) => {
  try {
    const registry = createRegistry(c.env);
    if (registry.seedDemo) await registry.seedDemo();
    return c.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
});

// ---- REST: datasets ----

app.get("/datasets", async (c) => {
  try {
    const convex = createRegistry(c.env);
    const identity = c.get("identity");
    const rows = await convex.listDatasets({
      tag: c.req.query("tag"),
      search: c.req.query("search") ?? c.req.query("q"),
      owner: c.req.query("owner"),
      includePrivateFor: identity?.subject,
      limit: Number(c.req.query("limit") ?? 50),
    });
    return c.json({ datasets: rows });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/datasets/:id", async (c) => {
  try {
    const deps = depsFrom(c);
    const ds = await deps.getDataset(c.req.param("id"));
    if (!ds) return c.json({ error: "Not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, c.get("identity"));
    return c.json(ds);
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/datasets/:id/schema", async (c) => {
  try {
    const deps = depsFrom(c);
    const ds = await deps.getDataset(c.req.param("id"));
    if (!ds) return c.json({ error: "Not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, c.get("identity"));
    // Prefer Convex denormalized schema; snapshot query could hit compute later
    return c.json(ds.schema ?? null);
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/datasets/:id/snapshots", async (c) => {
  try {
    const deps = depsFrom(c);
    const ds = await deps.getDataset(c.req.param("id"));
    if (!ds) return c.json({ error: "Not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, c.get("identity"));

    // Prefer registry metadata (fast, reliable). Enrich from compute when available.
    const registrySnaps = ds.latestSnapshotId
      ? [
          {
            snapshotId: ds.latestSnapshotId,
            summary: { "total-records": String(ds.rowCount ?? 0) },
          },
        ]
      : [];

    if (!(c.env.COMPUTE || c.env.COMPUTE_URL)) {
      return c.json({ snapshots: registrySnaps });
    }
    try {
      const compute = createComputeClientFromEnv(c.env);
      const snaps = await Promise.race([
        compute.snapshots(ds.icebergTable ?? ds.id, ds.icebergNamespace ?? "default"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
      if (Array.isArray(snaps) && snaps.length) return c.json({ snapshots: snaps });
    } catch {
      /* use registry */
    }
    return c.json({ snapshots: registrySnaps });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/datasets/:id/lineage", async (c) => {
  try {
    const deps = depsFrom(c);
    const ds = await deps.getDataset(c.req.param("id"));
    if (!ds) return c.json({ error: "Not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, c.get("identity"));
    const lineage = await buildLineage(ds, deps.getDataset);
    return c.json(lineage);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/datasets/:id/query", async (c) => {
  try {
    const body = (await c.req.json()) as Partial<QueryRequest> & {
      save?: boolean;
      name?: string;
      visibility?: Visibility;
    };
    const req: QueryRequest = {
      datasetId: c.req.param("id"),
      columns: body.columns,
      filter: body.filter,
      snapshot: body.snapshot,
      mode: body.mode,
      limit: body.limit,
      branch: body.branch,
    };
    // Warm-tier bookkeeping (non-blocking routing for MVP — still uses cold path)
    try {
      const id = c.env.WARM_ROUTER_DO.idFromName(req.datasetId);
      const stub = c.env.WARM_ROUTER_DO.get(id);
      c.executionCtx.waitUntil(stub.fetch("https://warm/record", { method: "POST" }));
    } catch {
      /* ignore if DO unavailable in tests */
    }
    const result = await resolveQuery(req, c.get("identity"), depsFrom(c));
    const identity = identityOrAnon(c.get("identity"), c.env);
    c.executionCtx.waitUntil(
      autoConnect(createSocialStore(c.env), identity?.subject, req.datasetId, "query"),
    );
    let queryId: string | undefined;
    if (body.save !== false && c.env.DB) {
      const owner = identity?.subject ?? "anon";
      const registry = createRegistry(c.env);
      const cached = (await registry.lookupCache(result.queryHash)) as {
        r2Url?: string;
        rowCount?: number;
        sizeBytes?: number;
      } | null;
      // Prefer durable cache key; fall back to result URL (Case A partition / Case B artifact)
      const base = c.env.R2_PUBLIC_BASE || new URL(c.req.url).origin;
      const rawR2 = cached?.r2Url ?? result.url;
      const r2Url = rawR2
        ? rawR2.startsWith("http")
          ? rawR2
          : publicResultUrl(base, rawR2)
        : undefined;
      const d1 = createD1Registry(c.env.DB);
      const saved = await d1.upsertQuery({
        owner,
        datasetId: req.datasetId,
        name: body.name ?? `Query ${result.queryHash.slice(0, 8)}`,
        visibility: body.visibility ?? "private",
        columns: req.columns,
        filter: req.filter,
        snapshotId: req.snapshot,
        branch: req.branch,
        limit: req.limit,
        queryHash: result.queryHash,
        r2Url,
        costTier: result.costTier,
        rowCount: result.rowCount ?? cached?.rowCount,
        sizeBytes: result.sizeBytes ?? cached?.sizeBytes,
      });
      queryId = saved.id;
    }
    return c.json({ ...result, queryId });
  } catch (e) {
    return errResponse(e);
  }
});

function attachQueryResultUrls<T extends { r2Url?: string }>(
  queries: T[],
  env: Env,
  reqUrl: string,
): (T & { resultUrl?: string })[] {
  const base = new URL(reqUrl).origin;
  const pubBase = env.R2_PUBLIC_BASE || base;
  return queries.map((q) => ({
    ...q,
    resultUrl: q.r2Url ? publicResultUrl(pubBase, q.r2Url) : undefined,
  }));
}

app.get("/datasets/:id/queries", async (c) => {
  try {
    if (!c.env.DB) return c.json({ queries: [] });
    const identity = identityOrAnon(c.get("identity"), c.env);
    const owner = identity?.subject ?? "anon";
    const deps = depsFrom(c);
    const ds = await deps.getDataset(c.req.param("id"));
    if (!ds) return c.json({ error: "Not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, c.get("identity"));
    const d1 = createD1Registry(c.env.DB);
    const list = await d1.listQueries({
      datasetId: c.req.param("id"),
      owner,
      includePublic: true,
    });
    return c.json({ queries: attachQueryResultUrls(list, c.env, c.req.url) });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/queries", async (c) => {
  try {
    if (!c.env.DB) return c.json({ queries: [] });
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const d1 = createD1Registry(c.env.DB);
    const list = await d1.listQueries({ owner: identity.subject, includePublic: false });
    return c.json({ queries: attachQueryResultUrls(list, c.env, c.req.url) });
  } catch (e) {
    return errResponse(e);
  }
});

app.patch("/queries/:id", async (c) => {
  try {
    if (!c.env.DB) return c.json({ error: "D1 not configured" }, 503);
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const body = (await c.req.json()) as { visibility?: Visibility };
    if (!body.visibility) return c.json({ error: "visibility required" }, 400);
    const d1 = createD1Registry(c.env.DB);
    const updated = await d1.setQueryVisibility(c.req.param("id"), body.visibility, identity.subject);
    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json(updated);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/datasets/:id/estimate", async (c) => {
  try {
    const body = (await c.req.json()) as Partial<QueryRequest>;
    const req: QueryRequest = {
      datasetId: c.req.param("id"),
      columns: body.columns,
      filter: body.filter,
      snapshot: body.snapshot,
      limit: body.limit,
    };
    const estimate = await resolveQuery(req, c.get("identity"), depsFrom(c), {
      estimateOnly: true,
    });
    return c.json(estimate);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/datasets/:id/sample", async (c) => {
  try {
    const deps = depsFrom(c);
    const ds = await deps.getDataset(c.req.param("id"));
    if (!ds) return c.json({ error: "Not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, c.get("identity"));
    const n = Number((await c.req.json().catch(() => ({}))).n ?? 20);
    const registryRows = (ds.schema?.sampleRows ?? []).slice(0, n);

    const identity = identityOrAnon(c.get("identity"), c.env);
    c.executionCtx.waitUntil(
      autoConnect(createSocialStore(c.env), identity?.subject, ds.id, "sample"),
    );

    // Prefer fast registry sample; only hit compute briefly when registry is empty.
    if (registryRows.length || !(c.env.COMPUTE || c.env.COMPUTE_URL)) {
      return c.json({ rows: registryRows });
    }
    try {
      const compute = createComputeClientFromEnv(c.env);
      const rows = await Promise.race([
        compute.sample(ds.icebergTable ?? ds.id, n, ds.icebergNamespace ?? "default"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
      if (Array.isArray(rows) && rows.length) return c.json({ rows });
    } catch {
      /* empty */
    }
    return c.json({ rows: registryRows });
  } catch (e) {
    return errResponse(e);
  }
});

// ---- Social: connections, feed, notifications ----

app.post("/datasets/:id/connect", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ error: "Social store not configured" }, 503);
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const deps = depsFrom(c);
    const ds = await deps.getDataset(c.req.param("id"));
    if (!ds) return c.json({ error: "Not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, c.get("identity"));
    const body = (await c.req.json().catch(() => ({}))) as { connected?: boolean };
    if (typeof body.connected === "boolean") {
      const current = await store.getConnection(identity.subject, ds.id);
      if (body.connected && !current) {
        await store.ensureConnection(identity.subject, ds.id, "manual");
        return c.json({ connected: true });
      }
      if (!body.connected && current) {
        await store.toggleConnection(identity.subject, ds.id);
        return c.json({ connected: false });
      }
      return c.json({ connected: Boolean(current) });
    }
    const out = await store.toggleConnection(identity.subject, ds.id, "manual");
    return c.json(out);
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/datasets/:id/connect", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ connected: false });
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ connected: false });
    const conn = await store.getConnection(identity.subject, c.req.param("id"));
    return c.json({ connected: !!conn, connection: conn });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/me/connections", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ connections: [] });
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const connections = await store.listConnections(identity.subject);
    return c.json({ connections });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/social/posts", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ error: "Social store not configured" }, 503);
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const body = (await c.req.json()) as CreateSocialPostRequest;
    if (!body.datasetId || !String(body.body ?? "").trim()) {
      return c.json({ error: "datasetId and body required" }, 400);
    }
    const deps = depsFrom(c);
    const ds = await deps.getDataset(body.datasetId);
    if (!ds) return c.json({ error: "Dataset not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, c.get("identity"));
    await store.ensureConnection(identity.subject, body.datasetId, "manual");
    const post = await store.createPost({
      authorId: identity.subject,
      authorName: body.authorName,
      datasetId: body.datasetId,
      body: String(body.body).trim(),
      source: body.source ?? "user",
      findings: body.findings,
      datasetOwner: ds.owner,
      datasetName: ds.name,
    });
    return c.json({ post });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/social/feed", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ posts: [] });
    const identity = identityOrAnon(c.get("identity"), c.env);
    const posts = await store.listFeed({
      userId: identity?.subject,
      datasetId: c.req.query("datasetId") ?? undefined,
      limit: Number(c.req.query("limit") ?? 40),
    });
    return c.json({ posts });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/social/posts/:id", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ error: "Not found" }, 404);
    const post = await store.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "Not found" }, 404);
    return c.json({ post });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/notifications", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ notifications: [] });
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const notifications = await store.listNotifications(
      identity.subject,
      Number(c.req.query("limit") ?? 50),
    );
    return c.json({
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
    });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/notifications/:id/read", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ error: "Social store not configured" }, 503);
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const out = await store.markNotificationRead(identity.subject, c.req.param("id"));
    return c.json(out);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/notifications/read-all", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ error: "Social store not configured" }, 503);
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const out = await store.markAllNotificationsRead(identity.subject);
    return c.json(out);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/datasets/:id/prompt", async (c) => {
  try {
    const deps = depsFrom(c);
    const id = c.req.param("id");
    const ds = await deps.getDataset(id);
    if (!ds) return c.json({ error: "Not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, c.get("identity"));

    if (!(c.env.COMPUTE || c.env.COMPUTE_URL)) {
      return c.json({ error: "Compute not configured for Hermes prompt" }, 503);
    }
    const body = (await c.req.json()) as {
      prompt?: string;
      execute?: boolean;
      snapshot?: string;
      namespace?: string;
      max_steps?: number;
    };
    if (!body.prompt?.trim()) return c.json({ error: "prompt required" }, 400);

    const identity = identityOrAnon(c.get("identity"), c.env) ?? { subject: "anon" };
    const apiBase =
      c.env.PUBLIC_API_BASE?.replace(/\/$/, "") ||
      c.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
      new URL(c.req.url).origin;
    let authToken: string | undefined;
    if (c.env.AGENT_TOKEN_SECRET) {
      authToken = await mintAgentToken(identity, {
        secret: c.env.AGENT_TOKEN_SECRET,
        datasetId: ds.id,
      });
    }

    const compute = createComputeClientFromEnv(c.env);
    const out = await compute.prompt({
      prompt: body.prompt,
      dataset_id: ds.icebergTable ?? ds.id,
      public_dataset_id: ds.id,
      namespace: body.namespace ?? ds.icebergNamespace ?? "default",
      execute: body.execute !== false,
      snapshot: body.snapshot,
      max_steps: body.max_steps,
      auth_token: authToken,
      api_base: apiBase,
      user_id: identity.subject,
      user_email: identity.email,
    });
    return c.json(out);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/datasets", async (c) => {
  try {
    const gated = requireClerkIdentity(c);
    if ("error" in gated) return c.json({ error: gated.error }, gated.status);
    const identity = gated.identity;

    const contentType = c.req.header("content-type") ?? "";
    let meta: {
      name: string;
      description?: string;
      tags?: string[];
      visibility?: Visibility;
      partition_hint?: string;
      sort_column?: string;
    };

    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") return c.json({ error: "file required" }, 400);
      const upload = file as unknown as { name: string; arrayBuffer: () => Promise<ArrayBuffer> };
      const fileBytes = await upload.arrayBuffer();
      const filename = upload.name || "upload.bin";
      meta = {
        name: String(form.get("name") ?? filename),
        description: form.get("description")?.toString(),
        tags: form.get("tags") ? String(form.get("tags")).split(",").map((t) => t.trim()) : [],
        visibility: (form.get("visibility")?.toString() as Visibility) ?? "private",
        partition_hint: form.get("partition_hint")?.toString(),
        sort_column: form.get("sort_column")?.toString(),
      };
      const datasetId = `ds_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const stagingKey = await putStaging(
        c.env.R2,
        datasetId,
        filename,
        fileBytes,
        "application/octet-stream",
      );
      const stagingPath = `s3://${c.env.R2_BUCKET ?? "trainfabric-data"}/${stagingKey}`;
      return await startIngest(c as never, identity, meta, stagingPath, datasetId);
    }

    const body = (await c.req.json()) as {
      name?: string;
      description?: string;
      tags?: string[] | string;
      visibility?: Visibility;
      partition_hint?: string;
      sort_column?: string;
      staging_key?: string;
      data_ref?: string;
      filename?: string;
      source_url?: string;
    };

    meta = {
      name: String(body.name ?? "dataset"),
      description: body.description,
      tags: Array.isArray(body.tags)
        ? body.tags
        : body.tags
          ? String(body.tags)
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      visibility: body.visibility ?? "private",
      partition_hint: body.partition_hint,
      sort_column: body.sort_column,
    };

    if (body.source_url !== undefined) {
      const sourceUrl = String(body.source_url).trim();
      if (!sourceUrl) {
        return c.json({ error: "Paste a Hugging Face or GitHub URL" }, 400);
      }
      // Validate URL + list matching files before creating a dataset/job
      let listed: Awaited<ReturnType<typeof listRemoteFiles>>;
      try {
        parseSourceUrl(sourceUrl);
        listed = await listRemoteFiles(sourceUrl);
      } catch (e) {
        if (e instanceof RemoteSourceError) {
          return c.json({ error: e.message }, e.status as 400);
        }
        throw e;
      }
      if (!meta.name || meta.name === "dataset") {
        // Derive a rough name from the URL path
        try {
          const u = new URL(sourceUrl.startsWith("http") ? sourceUrl : `https://${sourceUrl}`);
          const parts = u.pathname.split("/").filter(Boolean);
          meta.name = parts[parts.length - 1] || parts[2] || "remote-dataset";
        } catch {
          meta.name = "remote-dataset";
        }
      }
      return await startRemoteIngest(c as never, identity, meta, sourceUrl, listed);
    }

    if (body.staging_key || body.data_ref) {
      return await startIngest(c as never, identity, meta, String(body.staging_key ?? body.data_ref));
    }

    return c.json({ error: "Provide multipart file, source_url, or staging_key/data_ref" }, 400);
  } catch (e) {
    if (e instanceof RemoteSourceError) {
      return c.json({ error: e.message }, e.status as 400);
    }
    return errResponse(e);
  }
});

/** List + download public HF/GitHub files in the background, then ingest. */
async function startRemoteIngest(
  c: {
    env: Env;
    executionCtx: { waitUntil: (p: Promise<unknown>) => void };
  },
  identity: Identity,
  meta: {
    name: string;
    description?: string;
    tags?: string[];
    visibility?: Visibility;
    partition_hint?: string;
    sort_column?: string;
  },
  _sourceUrl: string,
  listed: Awaited<ReturnType<typeof listRemoteFiles>>,
) {
  const datasetId = `ds_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const convex = createRegistry(c.env);
  const jobId = `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const bucket = c.env.R2_BUCKET ?? "trainfabric-data";

  const kindLabel = listed.kind === "hf" ? "Hugging Face" : "GitHub";

  await convex.createDataset({
    datasetId,
    owner: identity.subject,
    visibility: meta.visibility ?? "private",
    name: meta.name,
    description: meta.description,
    tags: [...(meta.tags ?? []), "remote-import", kindLabel === "Hugging Face" ? "huggingface" : "github"],
    kind: "base",
  });
  await convex.setJob({
    jobId,
    datasetId,
    kind: "ingest",
    status: "pending",
  });

  const doId = c.env.CATALOG_DO.idFromName(datasetId);
  const stub = c.env.CATALOG_DO.get(doId);

  c.executionCtx.waitUntil(
    (async () => {
      try {
        await convex.setJob({ jobId, status: "running", progress: 20 });
        const { stagingPath, fileCount } = await downloadRemoteToR2(
          c.env.R2,
          datasetId,
          listed.files,
          bucket,
        );
        await convex.setJob({ jobId, status: "running", progress: 50 });

        const ingestAbort = new AbortController();
        const ingestTimer = setTimeout(() => ingestAbort.abort(), 180_000);
        let res: Response;
        try {
          res = await stub.fetch("https://catalog/commit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "ingest",
              computeUrl: computeUrlFor(c.env),
              payload: {
                staging_path: stagingPath,
                dataset_id: datasetId,
                partition_hint: meta.partition_hint,
                sort_column: meta.sort_column,
              },
            }),
            signal: ingestAbort.signal,
          });
        } catch (e) {
          const msg =
            e instanceof Error && e.name === "AbortError"
              ? "Ingest timed out waiting for compute (try again — cold start can take a minute)"
              : e instanceof Error
                ? e.message
                : String(e);
          throw new Error(msg);
        } finally {
          clearTimeout(ingestTimer);
        }
        await convex.setJob({ jobId, status: "running", progress: 75 });
        const json = (await res.json()) as {
          error?: string;
          schemaContract?: Record<string, unknown>;
          snapshotId?: string;
          icebergTable?: string;
          namespace?: string;
        };
        if (!res.ok || json.error) throw new Error(json.error ?? "ingest failed");
        await convex.updateAfterIngest({
          datasetId,
          snapshotId: json.snapshotId,
          rowCount: json.schemaContract?.rowCount,
          sizeBytes: json.schemaContract?.sizeBytes,
          schema: json.schemaContract,
          icebergNamespace: json.namespace,
          icebergTable: json.icebergTable,
        });
        await convex.setJob({
          jobId,
          status: "done",
          progress: 100,
          resultRef: `${json.snapshotId ?? ""}:${fileCount}files`,
        });

        const ds = (await convex.getDataset(datasetId)) as DatasetRecord;
        if (ds) {
          await upsertDatasetEmbedding(c.env.AI as never, c.env.VECTORIZE as never, ds);
        }
      } catch (e) {
        await convex.setJob({
          jobId,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })(),
  );

  return Response.json({
    datasetId,
    jobId,
    source: kindLabel,
  });
}

async function startIngest(
  c: {
    env: Env;
    executionCtx: { waitUntil: (p: Promise<unknown>) => void };
  },
  identity: Identity,
  meta: {
    name: string;
    description?: string;
    tags?: string[];
    visibility?: Visibility;
    partition_hint?: string;
    sort_column?: string;
  },
  stagingPath: string,
  datasetId = `ds_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
) {
  const convex = createRegistry(c.env);
  const jobId = `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  await convex.createDataset({
    datasetId,
    owner: identity.subject,
    visibility: meta.visibility ?? "private",
    name: meta.name,
    description: meta.description,
    tags: meta.tags ?? [],
    kind: "base",
  });
  await convex.setJob({
    jobId,
    datasetId,
    kind: "ingest",
    status: "pending",
  });

  // Serialize commit through CatalogDO
  const doId = c.env.CATALOG_DO.idFromName(datasetId);
  const stub = c.env.CATALOG_DO.get(doId);

  c.executionCtx.waitUntil(
    (async () => {
      await convex.setJob({ jobId, status: "running", progress: 10 });
      try {
        const res = await stub.fetch("https://catalog/commit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "ingest",
            computeUrl: computeUrlFor(c.env),
            payload: {
              staging_path: stagingPath,
              dataset_id: datasetId,
              partition_hint: meta.partition_hint,
              sort_column: meta.sort_column,
            },
          }),
        });
        const json = (await res.json()) as {
          error?: string;
          schemaContract?: Record<string, unknown>;
          snapshotId?: string;
          icebergTable?: string;
          namespace?: string;
        };
        if (!res.ok || json.error) throw new Error(json.error ?? "ingest failed");
        await convex.updateAfterIngest({
          datasetId,
          snapshotId: json.snapshotId,
          rowCount: json.schemaContract?.rowCount,
          sizeBytes: json.schemaContract?.sizeBytes,
          schema: json.schemaContract,
          icebergNamespace: json.namespace,
          icebergTable: json.icebergTable,
        });
        await convex.setJob({ jobId, status: "done", progress: 100, resultRef: json.snapshotId });

        // Embed for semantic discovery
        const ds = (await convex.getDataset(datasetId)) as DatasetRecord;
        if (ds) {
          await upsertDatasetEmbedding(c.env.AI as never, c.env.VECTORIZE as never, ds);
        }
      } catch (e) {
        await convex.setJob({
          jobId,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })(),
  );

  return Response.json({
    datasetId,
    jobId,
  });
}

app.post("/datasets/derived", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json();
    const deps = depsFrom(c);
    const convex = createRegistry(c.env);

    const sources: DatasetRecord[] = [];
    for (const s of body.spec.sources) {
      const ds = await deps.getDataset(s.datasetId);
      if (!ds) return c.json({ error: `Source ${s.datasetId} not found` }, 404);
      sources.push(ds);
    }
    if (!visibilityAllowed(body.visibility, sources)) {
      return c.json({ error: "Public derived dataset cannot reference private sources" }, 400);
    }

    const datasetId = `ds_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    if (
      detectCycle(datasetId, body.spec, (id) => {
        const found = sources.find((s) => s.id === id);
        const spec = found?.derivedSpec as { sources?: { datasetId: string }[] } | undefined;
        return spec?.sources?.map((x) => x.datasetId);
      })
    ) {
      return c.json({ error: "Cycle detected in derived sources" }, 400);
    }

    const decision = await decideMaterialization(body.spec, identity, deps);
    await convex.createDataset({
      datasetId,
      owner: identity.subject,
      visibility: body.visibility,
      name: body.name,
      description: body.description,
      tags: body.tags ?? [],
      kind: "derived",
      derivedSpec: body.spec,
      materializationDecision: decision,
    });

    let jobId: string | undefined;
    if (decision.mode === "materialized") {
      jobId = `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      await convex.setJob({ jobId, datasetId, kind: "materialize", status: "pending" });
      // Kick materialize via CatalogDO (runs first source query for MVP single-source)
      const doId = c.env.CATALOG_DO.idFromName(datasetId);
      const stub = c.env.CATALOG_DO.get(doId);
      const src = body.spec.sources[0];
      c.executionCtx.waitUntil(
        (async () => {
          await convex.setJob({ jobId: jobId!, status: "running" });
          try {
            if (!(c.env.COMPUTE || c.env.COMPUTE_URL)) {
              throw new Error("Compute not configured");
            }
            const compute = createComputeClientFromEnv(c.env);
            // For MVP materialize: execute the source query and register as new table via ingest of result
            let stagingPath: string | undefined;
            if (src.resultR2Url) {
              stagingPath = objectKeyFromUri(src.resultR2Url);
            } else if (src.queryId && c.env.DB) {
              const d1 = createD1Registry(c.env.DB);
              const sq = await d1.getQuery(src.queryId);
              if (sq?.r2Url) stagingPath = objectKeyFromUri(sq.r2Url);
            }
            const q = stagingPath
              ? { mode: "link" as const, r2Path: stagingPath, rowCount: 0, sizeBytes: 0 }
              : await compute.query({
                  datasetId: src.datasetId,
                  columns: src.query.columns,
                  filter: src.query.filter,
                  snapshot: src.snapshotPin ?? src.query.snapshot,
                  queryHash: `mat_${datasetId}`,
                  mode: "link",
                });
            if (q.r2Path) {
              const ingest = await stub.fetch("https://catalog/commit", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  action: "ingest",
                  computeUrl: computeUrlFor(c.env),
                  payload: {
                    staging_path: q.r2Path,
                    dataset_id: datasetId,
                  },
                }),
              });
              const json = (await ingest.json()) as {
                snapshotId?: string;
                schemaContract?: Record<string, unknown>;
                namespace?: string;
                icebergTable?: string;
                error?: string;
              };
              if (json.error) throw new Error(json.error);
              await convex.updateAfterIngest({
                datasetId,
                snapshotId: json.snapshotId,
                rowCount: json.schemaContract?.rowCount,
                sizeBytes: json.schemaContract?.sizeBytes,
                schema: json.schemaContract,
                icebergNamespace: json.namespace,
                icebergTable: json.icebergTable,
              });
            }
            await convex.setJob({ jobId: jobId!, status: "done", progress: 100 });
          } catch (e) {
            await convex.setJob({
              jobId: jobId!,
              status: "error",
              error: e instanceof Error ? e.message : String(e),
            });
          }
        })(),
      );
    }

    return c.json({
      datasetId,
      jobId,
      materialization: decision,
    });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/datasets/:id/rebuild", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const deps = depsFrom(c);
    const ds = await deps.getDataset(c.req.param("id"));
    if (!ds) return c.json({ error: "Not found" }, 404);
    if (ds.owner !== identity.subject) return c.json({ error: "Forbidden" }, 403);
    if (ds.kind !== "derived" || ds.materializationDecision?.mode !== "materialized") {
      return c.json({ error: "Only materialized derived datasets can be rebuilt" }, 400);
    }
    // Re-use derived create materialize path — set job and kick CatalogDO
    const convex = createRegistry(c.env);
    const jobId = `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await convex.setJob({ jobId, datasetId: ds.id, kind: "rebuild", status: "pending" });
    return c.json({ jobId, status: "pending" });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/results/:hash", async (c) => {
  try {
    const convex = createRegistry(c.env);
    const entry = (await convex.lookupCache(c.req.param("hash"))) as {
      r2Url: string;
      rowCount: number;
      sizeBytes: number;
    } | null;
    if (!entry) return c.json({ error: "Not found" }, 404);
    const url = publicResultUrl(c.env.R2_PUBLIC_BASE || new URL(c.req.url).origin, entry.r2Url);
    return c.json({ ...entry, url });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/jobs/:id", async (c) => {
  try {
    const convex = createRegistry(c.env);
    const job = await convex.getJob(c.req.param("id"));
    if (!job) return c.json({ error: "Not found" }, 404);
    return c.json(job);
  } catch (e) {
    return errResponse(e);
  }
});

/* ── Autoresearch /auto ─────────────────────────────────────────── */

app.post("/datasets/:id/auto", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const deps = depsFrom(c);
    const ds = await deps.getDataset(c.req.param("id"));
    if (!ds) return c.json({ error: "Not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, identity);

    const body = (await c.req.json()) as CreateAutoRunRequest;
    const store = createAutoStore(c.env);
    const box = boxClientFromEnv(c.env);
    const origin = c.env.PUBLIC_API_URL || new URL(c.req.url).origin;
    const run = await createAutoRun({
      store,
      box,
      datasetId: ds.id,
      ownerId: identity.subject,
      body,
      tfApiUrl: origin,
      campaignToken: c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") || "anon",
      env: c.env,
    });
    return c.json(run, 201);
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/datasets/:id/auto", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    const deps = depsFrom(c);
    const ds = await deps.getDataset(c.req.param("id"));
    if (!ds) return c.json({ error: "Not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, identity);
    const store = createAutoStore(c.env);
    const runs = await store.listAutoRuns(ds.id);
    return c.json({ runs });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const body = (await c.req.json()) as CreateAutoRunRequest;
    // If a dataset hint is given, authorize it.
    if (body.datasetId) {
      const deps = depsFrom(c);
      const ds = await deps.getDataset(body.datasetId);
      if (ds) {
        const { authorizeDataset } = await import("./resolver");
        authorizeDataset(ds, identity);
      }
    }
    const store = createAutoStore(c.env);
    const box = boxClientFromEnv(c.env);
    const origin = c.env.PUBLIC_API_URL || new URL(c.req.url).origin;
    const run = await createAutoRun({
      store,
      box,
      datasetId: body.datasetId,
      ownerId: identity.subject,
      body,
      tfApiUrl: origin,
      campaignToken: c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") || "anon",
      env: c.env,
    });
    return c.json(run, 201);
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/auto", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const runs = await store.listAutoRunsByOwner(identity.subject);
    return c.json({
      runs,
      prerequisites: {
        boxConfigured: Boolean(c.env.BOX_API_KEY),
        modalConfigured: Boolean(c.env.MODAL_TOKEN && c.env.MODAL_APP_REF),
        note: c.env.BOX_API_KEY
          ? "Box API key is set on the Worker — new agents provision real sandboxes."
          : "No BOX_API_KEY on the Worker — agents start in stub mode (control plane only). Set BOX_API_KEY in router secrets for live Box sandboxes.",
      },
    });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/auto/:id", async (c) => {
  try {
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const [trials, activity, messages] = await Promise.all([
      store.listAutoTrials(run.id),
      store.listActivity(run.id).catch(() => []),
      store.listMessages(run.id).catch(() => []),
    ]);
    let events: unknown[] = [];
    const box = boxClientFromEnv(c.env);
    if (box && run.box.boxId && !run.box.boxId.startsWith("stub_")) {
      try {
        const ev = await box.events(run.box.boxId, run.box.lastEventCursor);
        events = ev.events;
        if (ev.cursor) {
          await store.upsertAutoRun({
            ...run,
            box: { ...run.box, lastEventCursor: ev.cursor },
          });
        }
      } catch {
        /* optional */
      }
    }
    return c.json({
      run,
      trials,
      activity,
      boundDatasets: run.boundDatasets ?? [],
      messages: messages.slice(-30),
      events,
    });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto/:id/instructions", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const body = (await c.req.json()) as ReportAutoInstructionsRequest;
    if (!body.content?.trim()) return c.json({ error: "content required" }, 400);
    const next = await reportInstructions({ store, run, body });
    return c.json(next);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto/:id/bind-dataset", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const isOwner = run.ownerId === identity.subject || identity.subject === "anon";
    const body = (await c.req.json()) as BindAutoDatasetRequest;
    if (!body.datasetId) return c.json({ error: "datasetId required" }, 400);
    // Resolve snapshot from dataset if not supplied, and authorize access.
    const deps = depsFrom(c);
    const ds = await deps.getDataset(body.datasetId);
    if (!ds) return c.json({ error: "Dataset not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, identity);
    const snapshotId = body.snapshotId || ds.latestSnapshotId || undefined;
    const next = await bindDataset({
      store,
      run,
      body: { ...body, snapshotId },
      boundBy: isOwner ? "user" : "agent",
    });
    return c.json(next);
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/auto/:id/messages", async (c) => {
  try {
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const messages = await store.listMessages(run.id);
    const limit = Number(c.req.query("limit") ?? 200);
    return c.json({ messages: messages.slice(-Math.max(1, limit)) });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto/:id/messages", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const body = (await c.req.json()) as PostAutoMessageRequest;
    const out = await postAutoMessage({
      store,
      box: boxClientFromEnv(c.env),
      run,
      content: String(body.content ?? ""),
      role: body.role,
      source: body.source ?? "api",
      meta: body.meta,
      ai: c.env.AI,
    });
    return c.json(out, 201);
  } catch (e) {
    return errResponse(e);
  }
});

// AI SDK UI message stream (data stream protocol) for useChat.
app.post("/auto/:id/messages/stream", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const body = (await c.req.json()) as {
      messages?: Array<{ role: string; content?: string; parts?: Array<{ type: string; text?: string }> }>;
      content?: string;
    };
    // useChat sends the full message list; take the last user message.
    let content = body.content ?? "";
    if (!content && Array.isArray(body.messages)) {
      const last = [...body.messages].reverse().find((m) => m.role === "user");
      content =
        last?.content ??
        last?.parts?.filter((p) => p.type === "text").map((p) => p.text ?? "").join("") ??
        "";
    }
    const out = await postAutoMessage({
      store,
      box: boxClientFromEnv(c.env),
      run,
      content,
      source: "dashboard",
      ai: c.env.AI,
    });
    return streamAiMessage(out.assistantMessage.id, out.assistantMessage.content);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto/:id/pause", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    if (run.ownerId !== identity.subject && identity.subject !== "anon") {
      return c.json({ error: "Forbidden" }, 403);
    }
    const next = await pauseAutoRun(store, boxClientFromEnv(c.env), run);
    return c.json(next);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto/:id/resume", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    if (run.ownerId !== identity.subject && identity.subject !== "anon") {
      return c.json({ error: "Forbidden" }, 403);
    }
    const next = await resumeAutoRun(store, boxClientFromEnv(c.env), run);
    return c.json(next);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto/:id/cancel", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    if (run.ownerId !== identity.subject && identity.subject !== "anon") {
      return c.json({ error: "Forbidden" }, 403);
    }
    const next = await cancelAutoRun(store, boxClientFromEnv(c.env), run);
    return c.json(next);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto/:id/trials", async (c) => {
  try {
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    if (run.status !== "running") return c.json({ error: `run is ${run.status}` }, 409);
    const body = (await c.req.json().catch(() => ({}))) as {
      hypothesis?: string;
      commitSha?: string;
    };
    const origin = c.env.PUBLIC_API_URL || new URL(c.req.url).origin;
    const trial = await enqueueTrial({
      store,
      run,
      hypothesis: body.hypothesis,
      commitSha: body.commitSha,
      callbackBaseUrl: origin,
      env: c.env,
    });
    return c.json(trial, 201);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto/:id/trials/:trialId/complete", async (c) => {
  try {
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const trial = await store.getAutoTrial(c.req.param("trialId"));
    if (!trial || trial.autoRunId !== run.id) return c.json({ error: "Trial not found" }, 404);
    const body = (await c.req.json()) as CompleteAutoTrialRequest;
    const out = await completeTrial({ store, run, trial, body });
    return c.json(out);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/runners/register", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const body = (await c.req.json()) as RegisterRunnerRequest;
    if (!body.name?.trim()) return c.json({ error: "name required" }, 400);
    const store = createAutoStore(c.env);
    const out = await registerRunner({ store, ownerId: identity.subject, body });
    return c.json(out, 201);
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/runners", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const runners = await store.listAutoRunners(identity.subject);
    return c.json({
      runners: runners.map((r) => ({
        id: r.id,
        name: r.name,
        capacity: r.capacity,
        lastHeartbeatAt: r.lastHeartbeatAt,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/runners/heartbeat", async (c) => {
  try {
    const store = createAutoStore(c.env);
    const runner = await authRunner(store, c.req.header("Authorization"));
    if (!runner) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ ok: true, runnerId: runner.id });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/runners/claim", async (c) => {
  try {
    const store = createAutoStore(c.env);
    const runner = await authRunner(store, c.req.header("Authorization"));
    if (!runner) return c.json({ error: "Unauthorized" }, 401);
    const trial = await store.claimPendingTrial(runner.id);
    if (!trial) return c.json({ trial: null });
    const run = await store.getAutoRun(trial.autoRunId);
    return c.json({ trial, run });
  } catch (e) {
    return errResponse(e);
  }
});

/** Proxied R2 GET (and ranged GET for Case A). */
app.get("/r2/*", async (c) => {
  const key = c.req.path.replace(/^\/r2\//, "");
  const obj = await c.env.R2.get(key);
  if (!obj) return c.json({ error: "Not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  const range = c.req.header("Range");
  if (range) {
    // R2 binding supports ranged reads via get(key, { range })
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : undefined;
      const ranged = await c.env.R2.get(key, {
        range: end != null ? { offset: start, length: end - start + 1 } : { offset: start },
      });
      if (!ranged) return c.json({ error: "Not found" }, 404);
      headers.set("content-range", range);
      return new Response(ranged.body, { status: 206, headers });
    }
  }
  return new Response(obj.body, { headers });
});

/** Case A proxied multi-range assembly. */
app.post("/datasets/:id/query/proxy", async (c) => {
  try {
    const body = (await c.req.json()) as QueryRequest;
    const req = { ...body, datasetId: c.req.param("id") };
    const result = await resolveQuery(req, c.get("identity"), depsFrom(c));
    if (result.costTier !== "A" || !result.manifest) {
      return c.json({ error: "Proxy mode only for Case A with manifest" }, 400);
    }
    // Stream first matching range for MVP (full multi-range assembly can be extended)
    const entry = result.manifest.entries[0];
    if (!entry) return c.json({ error: "Empty manifest" }, 404);
    const key = objectKeyFromUri(entry.file);
    const range = entry.ranges[0];
    const obj = range
      ? await c.env.R2.get(key, {
          range:
            range[1] >= 0
              ? { offset: range[0], length: range[1] - range[0] + 1 }
              : { offset: range[0] },
        })
      : await c.env.R2.get(key);
    if (!obj) return c.json({ error: "Object missing" }, 404);
    return new Response(obj.body, {
      headers: { "content-type": "application/octet-stream", "x-cost-tier": "A" },
    });
  } catch (e) {
    return errResponse(e);
  }
});

function buildMcpContext(c: {
  env: Env;
  get: (k: "identity") => Identity | null;
  req: { url: string };
}): McpContext {
  const deps = depsFrom(c);
  const convex = createRegistry(c.env);
  const hasCompute = Boolean(c.env.COMPUTE || c.env.COMPUTE_URL);
  const compute = hasCompute ? createComputeClientFromEnv(c.env) : null;
  const identity = c.get("identity");

  return {
    identity,
    deps,
    listDatasets: async (opts) =>
      (await convex.listDatasets({
        search: opts.search,
        tag: opts.tag,
        includePrivateFor: opts.includePrivateFor,
      })) as DatasetRecord[],
    getSchema: async (id) => {
      const ds = await deps.getDataset(id);
      return ds?.schema ?? null;
    },
    sample: async (id, n) => {
      const ds = await deps.getDataset(id);
      const registryRows = (ds?.schema?.sampleRows ?? []).slice(0, n);
      // Prefer registry samples (demo + recently published); match REST /sample.
      if (registryRows.length || !compute) return registryRows;
      try {
        return await compute.sample(
          ds?.icebergTable ?? id,
          n,
          ds?.icebergNamespace ?? "default",
        );
      } catch {
        return registryRows;
      }
    },
    publish: async (args) => {
      // Simplified: expect data_ref already staged
      const datasetId = `ds_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const jobId = `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      await convex.createDataset({
        datasetId,
        owner: String(args.owner),
        visibility: (args.visibility as Visibility) ?? "private",
        name: String(args.name),
        description: args.description as string | undefined,
        tags: (args.tags as string[]) ?? [],
        kind: "base",
      });
      await convex.setJob({ jobId, datasetId, kind: "ingest", status: "pending" });
      const doId = c.env.CATALOG_DO.idFromName(datasetId);
      const stub = c.env.CATALOG_DO.get(doId);
      // Fire and forget
      void stub.fetch("https://catalog/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "ingest",
          computeUrl: computeUrlFor(c.env),
          payload: {
            staging_path: String(args.data_ref),
            dataset_id: datasetId,
            partition_hint: args.partition_hint,
            sort_column: args.sort_column,
          },
        }),
      }).then(async (res) => {
        const json = (await res.json()) as {
          snapshotId?: string;
          schemaContract?: Record<string, unknown>;
          namespace?: string;
          icebergTable?: string;
          error?: string;
        };
        if (json.error) {
          await convex.setJob({ jobId, status: "error", error: json.error });
          return;
        }
        await convex.updateAfterIngest({
          datasetId,
          snapshotId: json.snapshotId,
          rowCount: json.schemaContract?.rowCount,
          sizeBytes: json.schemaContract?.sizeBytes,
          schema: json.schemaContract,
          icebergNamespace: json.namespace,
          icebergTable: json.icebergTable,
        });
        await convex.setJob({ jobId, status: "done", progress: 100 });
      });
      return { datasetId, jobId };
    },
    getJob: (id) => convex.getJob(id),
    createDerived: async (args) => {
      // Delegate to same logic as REST — simplified inline
      const sources: DatasetRecord[] = [];
      for (const s of args.sources as { datasetId: string }[]) {
        const ds = await deps.getDataset(s.datasetId);
        if (!ds) throw new NotFoundError(`Source ${s.datasetId}`);
        sources.push(ds);
      }
      if (!visibilityAllowed(args.visibility, sources)) {
        throw new AuthError("Public derived cannot reference private sources");
      }
      const spec = {
        sources: args.sources,
        combine: args.combine,
        materialization: args.materialization ?? "auto",
        followLatest: true,
      };
      const decision = await decideMaterialization(spec as never, identity, deps);
      const affordances: string[] = [];
      if (args.materialization === "materialized" && decision.reason.includes("Case A")) {
        affordances.push("Spec is Case-A-cheap — pointer would be free (no data duplicated).");
      }
      const datasetId = `ds_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await convex.createDataset({
        datasetId,
        owner: identity!.subject,
        visibility: args.visibility,
        name: args.name,
        description: args.description,
        tags: args.tags ?? [],
        kind: "derived",
        derivedSpec: spec,
        materializationDecision: decision,
      });
      return { datasetId, materialization: decision, affordances };
    },
    previewDerived: async (spec) => {
      const decision = await decideMaterialization(spec, identity, deps);
      return {
        decision,
        estimate: "Run estimate_query on each source for byte estimates",
        createsNothing: true,
      };
    },
    getLineage: async (id) => {
      const ds = await deps.getDataset(id);
      if (!ds) throw new NotFoundError();
      return buildLineage(ds, deps.getDataset);
    },
    promptQuery: async (args) => {
      if (!(c.env.COMPUTE || c.env.COMPUTE_URL)) {
        throw new Error("Compute not configured for Hermes prompt");
      }
      const ds = await deps.getDataset(args.dataset_id);
      if (!ds) throw new NotFoundError();
      const id = identity ?? { subject: "anon" };
      const apiBase =
        c.env.PUBLIC_API_BASE?.replace(/\/$/, "") ||
        c.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
        new URL(c.req.url).origin;
      let authToken: string | undefined;
      if (c.env.AGENT_TOKEN_SECRET) {
        authToken = await mintAgentToken(id, {
          secret: c.env.AGENT_TOKEN_SECRET,
          datasetId: ds.id,
        });
      }
      const compute = createComputeClientFromEnv(c.env);
      return compute.prompt({
        prompt: args.prompt,
        dataset_id: ds.icebergTable ?? ds.id,
        public_dataset_id: ds.id,
        namespace: args.namespace ?? ds.icebergNamespace ?? "default",
        execute: args.execute !== false,
        snapshot: args.snapshot,
        auth_token: authToken,
        api_base: apiBase,
        user_id: id.subject,
        user_email: id.email,
      });
    },
    autoConnect: async (datasetId, source) => {
      await autoConnect(createSocialStore(c.env), identity?.subject, datasetId, source);
    },
    postSocialUpdate: async (args) => {
      const store = createSocialStore(c.env);
      if (!store) throw new Error("Social store not configured");
      if (!identity) throw new AuthError("Auth required");
      const ds = await deps.getDataset(args.datasetId);
      return store.createPost({
        authorId: identity.subject,
        authorName: args.authorName,
        datasetId: args.datasetId,
        body: args.body,
        source: "agent",
        findings: args.findings,
        datasetOwner: ds?.owner,
        datasetName: ds?.name,
      });
    },
    connectDataset: async (datasetId) => {
      const store = createSocialStore(c.env);
      if (!store) throw new Error("Social store not configured");
      if (!identity) throw new AuthError("Auth required");
      await store.ensureConnection(identity.subject, datasetId, "manual");
      return { connected: true };
    },
    listFeed: async (limit) => {
      const store = createSocialStore(c.env);
      if (!store) return [];
      return store.listFeed({ userId: identity?.subject, limit });
    },
    listConnections: async () => {
      const store = createSocialStore(c.env);
      if (!store || !identity) return [];
      return store.listConnections(identity.subject);
    },
    startAuto: async (args) => {
      if (!identity) throw new AuthError("Auth required");
      const store = createAutoStore(c.env);
      const origin = c.env.PUBLIC_API_URL || new URL(c.req.url).origin;
      return createAutoRun({
        store,
        box: boxClientFromEnv(c.env),
        datasetId: args.dataset_id,
        ownerId: identity.subject,
        body: {
          goal: args.goal,
          repoUrl: args.repo_url,
          defaultBranch: args.default_branch,
          datasetId: args.dataset_id,
          protocol: args.protocol,
          compute: args.compute,
          templateId: args.template_id,
        },
        tfApiUrl: origin,
        campaignToken: "mcp",
        env: c.env,
      });
    },
    checkAuto: async (autoRunId) => {
      const store = createAutoStore(c.env);
      const run = await store.getAutoRun(autoRunId);
      if (!run) throw new NotFoundError();
      const [trials, activity] = await Promise.all([
        store.listAutoTrials(run.id),
        store.listActivity(run.id).catch(() => []),
      ]);
      return { run, trials, activity, boundDatasets: run.boundDatasets ?? [] };
    },
    listAutoRuns: async (datasetId) => {
      const store = createAutoStore(c.env);
      return store.listAutoRuns(datasetId);
    },
    pauseAuto: async (autoRunId, action = "pause") => {
      if (!identity) throw new AuthError("Auth required");
      const store = createAutoStore(c.env);
      const run = await store.getAutoRun(autoRunId);
      if (!run) throw new NotFoundError();
      if (run.ownerId !== identity.subject && identity.subject !== "anon") {
        throw new AuthError("Forbidden");
      }
      const box = boxClientFromEnv(c.env);
      if (action === "resume") return resumeAutoRun(store, box, run);
      if (action === "cancel") return cancelAutoRun(store, box, run);
      return pauseAutoRun(store, box, run);
    },
    bindAutoDataset: async (autoRunId, datasetId, reason) => {
      const store = createAutoStore(c.env);
      const run = await store.getAutoRun(autoRunId);
      if (!run) throw new NotFoundError();
      const ds = await deps.getDataset(datasetId);
      if (!ds) throw new NotFoundError();
      authorizeDataset(ds, identity);
      const boundBy =
        run.ownerId === identity?.subject || identity?.subject === "anon" ? "user" : "agent";
      return bindDataset({
        store,
        run,
        body: { datasetId, snapshotId: ds.latestSnapshotId ?? undefined, reason },
        boundBy,
      });
    },
    messageAutoAgent: async (autoRunId, message) => {
      const store = createAutoStore(c.env);
      const run = await store.getAutoRun(autoRunId);
      if (!run) throw new NotFoundError();
      return postAutoMessage({
        store,
        box: boxClientFromEnv(c.env),
        run,
        content: message,
        source: "mcp",
        ai: c.env.AI,
      });
    },
    listAutoMessages: async (autoRunId, limit) => {
      const store = createAutoStore(c.env);
      const run = await store.getAutoRun(autoRunId);
      if (!run) throw new NotFoundError();
      const messages = await store.listMessages(run.id);
      return messages.slice(-Math.max(1, limit ?? 50));
    },
    ai: c.env.AI,
    vectorize: c.env.VECTORIZE,
  };
}

async function buildLineage(
  root: DatasetRecord,
  getDataset: (id: string) => Promise<DatasetRecord | null>,
): Promise<unknown> {
  async function walk(id: string, seen: Set<string>): Promise<unknown> {
    if (seen.has(id)) return { datasetId: id, name: "(cycle)", children: [] };
    seen.add(id);
    const d = await getDataset(id);
    if (!d) return { datasetId: id, name: "(missing)", children: [] };
    const children = [];
    const spec = d.derivedSpec as { sources?: { datasetId: string }[] } | undefined;
    if (spec?.sources) {
      for (const s of spec.sources) {
        children.push(await walk(s.datasetId, new Set(seen)));
      }
    }
    return { datasetId: d.id, name: d.name, kind: d.kind, children };
  }
  return walk(root.id, new Set());
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Proper MCP (Streamable HTTP) — agents createMcpHandler + MCP SDK
    if (path === "/mcp" || path.startsWith("/mcp/")) {
      return handleTrainfabricMcp(request, env, ctx, async (req) => {
        const auth = req.headers.get("Authorization");
        let identity = await verifyClerkJwt(auth, {
          CLERK_JWT_ISSUER: env.CLERK_JWT_ISSUER,
          CLERK_JWT_AUDIENCE: env.CLERK_JWT_AUDIENCE,
        });
        if (!identity) {
          const agent = await verifyAgentToken(auth, env.AGENT_TOKEN_SECRET);
          if (agent && agentHasReadScope(agent.scope)) {
            identity = { subject: agent.subject, email: agent.email };
          }
        }
        identity = identityOrAnon(identity, env);
        return buildMcpContext({
          env,
          get: () => identity,
          req: { url: req.url },
        });
      });
    }

    const isApi =
      path === "/health" ||
      path === "/auth/whoami" ||
      path.startsWith("/admin/") ||
      path.startsWith("/jobs/") ||
      path === "/auto" ||
      path.startsWith("/auto/") ||
      path.startsWith("/runners") ||
      path.startsWith("/results/") ||
      path.startsWith("/r2/") ||
      path.startsWith("/social/") ||
      path === "/notifications" ||
      path.startsWith("/notifications/") ||
      path === "/me/connections" ||
      path === "/datasets" ||
      path === "/datasets/derived" ||
      /^\/datasets\/[^/]+$/.test(path) ||
      path === "/queries" ||
      /^\/queries\/[^/]+$/.test(path) ||
      /^\/datasets\/[^/]+\/(schema|snapshots|lineage|query|queries|estimate|sample|rebuild|prompt|connect|auto)$/.test(
        path,
      ) ||
      /^\/datasets\/[^/]+\/query\/proxy$/.test(path);
    if (!isApi) {
      const dash = (env.DASHBOARD_URL ?? "").replace(/\/$/, "");
      if (dash) {
        return Response.redirect(`${dash}${path}${url.search}`, 302);
      }
      return Response.json(
        {
          service: "trainfabric-router",
          message: "API only — dashboard is hosted on Vercel",
          health: "/health",
          mcp: "/mcp",
        },
        { status: path === "/" ? 200 : 404 },
      );
    }
    return app.fetch(request, env, ctx);
  },
};
