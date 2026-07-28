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
import { resolveBearerIdentity, type AuthVia } from "./auth";
import { mintAgentToken } from "./agentToken";
import { createClerkApiKey } from "./clerkApiKeys";
import { createApiKeyStore } from "./apiKeys";
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
import { TrainfabricAgentDO } from "./TrainfabricAgentDO";
import { runTrainfabricAgentTurn } from "./agentLoop";
import type { AgentStoredMessage } from "./TrainfabricAgentDO";
import {
  autoConnect,
  createSocialStore,
  enrichPostsWithProfiles,
  upsertProfileFromIdentity,
} from "./social";
import type {
  BindAutoDatasetRequest,
  CompleteAutoTrialRequest,
  CreateAutoRunRequest,
  CreateGithubRepoRequest,
  CreateSocialPostRequest,
  PostAutoMessageRequest,
  RegisterRunnerRequest,
  ReportAutoInstructionsRequest,
  UpsertProfileRequest,
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
  ownsAutoRun,
  pauseAutoRun,
  heartbeatAutoRun,
  postAutoMessage,
  reconcileAutoRunLiveness,
  registerRunner,
  reportInstructions,
  resumeAutoRun,
  verifyTrialCompletion,
} from "./auto";
import {
  authenticatedCloneUrl,
  buildConnectUrl,
  buildInstallUrl,
  buildUserOAuthUrl,
  createAppJwt,
  createInstallationAccessToken,
  createRepoUnderInstallation,
  dashboardOrigin,
  exchangeOAuthCode,
  getGithubUser,
  githubConfigured,
  installationExistsOnGithub,
  inspectInstallationResearchBrief,
  inspectPublicResearchBrief,
  listInstallationRepoTree,
  listInstallationRepos,
  listUserInstallations,
  signInstallState,
  verifyInstallState,
  verifyWebhookSignature,
} from "./github";
import { enrichResearchGoal } from "./goalEnrich";
import {
  createGithubStore,
  decryptUserToken,
  encryptUserToken,
  tokenCryptoKey,
} from "./githubStore";
import {
  buildHfConnectUrl,
  exchangeHfOAuthCode,
  getHfUser,
  hfConfigured,
  hfDashboardOrigin,
  listHfDatasets,
  signHfOAuthState,
  verifyHfOAuthState,
} from "./huggingface";
import {
  createHfStore,
  decryptHfToken,
  encryptHfToken,
} from "./huggingfaceStore";
import type { RemoteAuth } from "./remoteSource";

export { CatalogDO, WarmRouterDO, ComputeContainerClass as ComputeContainer, TrainfabricAgentDO };

export interface Env {
  R2: R2Bucket;
  DB?: D1Database;
  CATALOG_DO: DurableObjectNamespace;
  WARM_ROUTER_DO: DurableObjectNamespace;
  COMPUTE?: DurableObjectNamespace<ComputeContainer>;
  TRAINFABRIC_AGENT_DO?: DurableObjectNamespace;
  VECTORIZE?: VectorizeIndex;
  AI?: Ai;
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
  /** Managed Trainfabric GPU trials (Modal-backed) */
  MODAL_TOKEN?: string;
  MODAL_APP_REF?: string;
  MODAL_API_BASE?: string;
  /** Public router origin for trial callbacks / Box env */
  PUBLIC_API_URL?: string;
  /** Public API base for Hermes tf CLI (same origin as this Worker). */
  PUBLIC_API_BASE?: string;
  /** HS256 secret for short-lived Hermes agent tokens. */
  AGENT_TOKEN_SECRET?: string;
  /** Clerk Backend API secret — verify/create user API keys (ak_*). */
  CLERK_SECRET_KEY?: string;
  /** GitHub App (install + user OAuth during install). */
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_WEBHOOK_SECRET?: string;
  GITHUB_APP_STATE_SECRET?: string;
  GITHUB_TOKEN_CRYPTO_KEY?: string;
  /** Hugging Face OAuth (Sign in with HF for private/gated pulls). */
  HF_OAUTH_CLIENT_ID?: string;
  HF_OAUTH_CLIENT_SECRET?: string;
  HF_OAUTH_STATE_SECRET?: string;
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

/** Owner-only AutoRun access (Clerk user or that user's agent token). */
function requireAutoRunOwner(
  run: { ownerId: string },
  identity: Identity | null | undefined,
): Response | null {
  if (!identity) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!ownsAutoRun(run, identity)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

type Variables = { identity: Identity | null; authVia: AuthVia };

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
    exposeHeaders: ["Mcp-Session-Id", "x-vercel-ai-ui-message-stream"],
  }),
);

app.use("*", async (c, next) => {
  const { identity, authVia } = await resolveBearerIdentity(c.req.header("Authorization"), c.env);
  c.set("identity", identity);
  c.set("authVia", authVia);
  await next();
});

function requireClerkIdentity(c: {
  get: (k: "identity" | "authVia") => Identity | null | AuthVia;
  env: Env;
}) {
  const identity = identityOrAnon(c.get("identity") as Identity | null, c.env);
  if (!identity) return { error: "Unauthorized" as const, status: 401 as const };
  if (c.get("authVia") === "agent") {
    return {
      error: "Agent tokens are read-only; use a Clerk session or API key for writes" as const,
      status: 403 as const,
    };
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

const UI_MESSAGE_STREAM_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive",
  "x-vercel-ai-ui-message-stream": "v1",
  "x-accel-buffering": "no",
} as const;

/**
 * Emit a Vercel AI SDK UI message stream (v5 SSE protocol) for `useChat`.
 * Chunks the assistant reply into text-deltas so the client renders progressively.
 * When `text` is a Promise, starts the SSE immediately and sends keepalives until
 * the reply is ready — avoids proxy/browser timeouts on long LLM tool loops.
 */
function streamAiMessage(messageId: string, text: string | Promise<string>): Response {
  const encoder = new TextEncoder();
  const send = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let keepalive: ReturnType<typeof setInterval> | undefined;
      try {
        controller.enqueue(send({ type: "start", messageId }));
        keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            /* closed */
          }
        }, 8_000);
        const resolved = await Promise.resolve(text);
        clearInterval(keepalive);
        keepalive = undefined;
        controller.enqueue(send({ type: "text-start", id: messageId }));
        const words = resolved.split(/(\s+)/);
        for (const w of words) {
          if (w) controller.enqueue(send({ type: "text-delta", id: messageId, delta: w }));
        }
        controller.enqueue(send({ type: "text-end", id: messageId }));
        controller.enqueue(send({ type: "finish", finishReason: "stop" }));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (e) {
        if (keepalive) clearInterval(keepalive);
        const errorText = e instanceof Error ? e.message : String(e);
        try {
          controller.enqueue(send({ type: "error", errorText }));
          controller.enqueue(send({ type: "finish", finishReason: "error" }));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          /* closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { ...UI_MESSAGE_STREAM_HEADERS } });
}

/** Pull the latest user text from an AI SDK `useChat` request body. */
function extractChatUserContent(body: {
  messages?: Array<{
    role: string;
    content?: unknown;
    parts?: Array<{ type: string; text?: string }>;
  }>;
  content?: unknown;
}): string {
  const fromUnknown = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) {
      return v
        .map((p) => {
          if (typeof p === "string") return p;
          if (p && typeof p === "object" && "text" in p) return String((p as { text?: unknown }).text ?? "");
          return "";
        })
        .join("");
    }
    return "";
  };
  let content = fromUnknown(body.content);
  if (!content.trim() && Array.isArray(body.messages)) {
    const last = [...body.messages].reverse().find((m) => m.role === "user");
    content =
      fromUnknown(last?.content) ||
      last?.parts?.filter((p) => p.type === "text").map((p) => p.text ?? "").join("") ||
      "";
  }
  return content.trim();
}

app.get("/health", (c) =>
  c.json({
    status: "ok",
    registry: "d1",
    compute: c.env.COMPUTE_URL ? "http" : c.env.COMPUTE ? "container" : "none",
  }),
);

/** Identity echo for tf whoami (Clerk session, API key, or agent token). */
app.get("/auth/whoami", async (c) => {
  const identity = identityOrAnon(c.get("identity"), c.env);
  if (!identity) return c.json({ error: "Unauthorized" }, 401);
  const authVia = c.get("authVia") ?? (identity.subject === "anon" ? "anon" : null);
  let profile = null;
  if (identity.subject !== "anon") {
    const store = createSocialStore(c.env);
    if (store) {
      // Provision/refresh the caller's profile so display identity is available.
      profile = await upsertProfileFromIdentity(store, identity, {
        isAgent: authVia === "agent",
      });
    }
  }
  return c.json({
    subject: identity.subject,
    email: identity.email ?? null,
    authVia,
    profile,
  });
});

function dashboardBase(env: Env, reqUrl: string): string {
  return (env.DASHBOARD_URL || "https://dashboard-opal-tau-54.vercel.app").replace(/\/$/, "") ||
    new URL(reqUrl).origin;
}

/** Start device authorization (CLI / MCP). */
app.post("/auth/device/code", async (c) => {
  const store = createApiKeyStore(c.env.DB);
  if (!store) return c.json({ error: "Auth store not configured" }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { client_name?: string };
  const started = await store.startDevice({
    clientName: body.client_name?.slice(0, 80) || "cli",
  });
  const dash = dashboardBase(c.env, c.req.url);
  const verificationUri = `${dash}/device`;
  const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(started.userCode)}`;
  return c.json({
    device_code: started.deviceCode,
    user_code: started.userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: started.expiresIn,
    interval: started.interval,
  });
});

/**
 * Poll device authorization.
 * RFC 8628-ish: authorization_pending | access_denied | expired_token | slow_down
 */
app.post("/auth/device/token", async (c) => {
  const store = createApiKeyStore(c.env.DB);
  if (!store) return c.json({ error: "Auth store not configured" }, 503);
  const body = (await c.req.json().catch(() => ({}))) as {
    device_code?: string;
    grant_type?: string;
  };
  const deviceCode = body.device_code?.trim();
  if (!deviceCode) return c.json({ error: "device_code required" }, 400);

  const row = await store.getByDeviceCode(deviceCode);
  if (!row) return c.json({ error: "invalid_grant", error_description: "Unknown device_code" }, 400);
  if (Date.now() > row.expires_at || row.status === "expired") {
    return c.json({ error: "expired_token" }, 400);
  }
  if (row.status === "pending") {
    return c.json({ error: "authorization_pending" }, 400);
  }
  if (row.status === "denied") {
    return c.json({ error: "access_denied" }, 400);
  }
  const accessToken = await store.consumeAccessToken(deviceCode);
  if (!accessToken) {
    return c.json({ error: "invalid_grant", error_description: "Token already redeemed" }, 400);
  }
  return c.json({
    access_token: accessToken,
    token_type: row.token_type || "Bearer",
    auth_via: "api_key",
    subject: row.user_id,
  });
});

/** Approve a device code while signed in (dashboard). Creates Clerk or Trainfabric API key. */
app.post("/auth/device/approve", async (c) => {
  const gate = requireClerkIdentity(c);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (gate.identity.subject === "anon") return c.json({ error: "Unauthorized" }, 401);

  const store = createApiKeyStore(c.env.DB);
  if (!store) return c.json({ error: "Auth store not configured" }, 503);

  const body = (await c.req.json().catch(() => ({}))) as {
    user_code?: string;
    name?: string;
  };
  const userCode = body.user_code?.trim();
  if (!userCode) return c.json({ error: "user_code required" }, 400);

  const pending = await store.getByUserCode(userCode);
  if (!pending) return c.json({ error: "Unknown or invalid code" }, 404);
  if (pending.status !== "pending") {
    return c.json({ error: `Code is ${pending.status}` }, 409);
  }
  if (Date.now() > pending.expires_at) {
    return c.json({ error: "Code expired" }, 410);
  }

  const clientLabel = pending.client_name || "device";
  const keyName = (body.name?.trim() || `${clientLabel} ${new Date().toISOString().slice(0, 10)}`).slice(
    0,
    80,
  );

  let accessToken: string | null = null;
  let tokenType = "api_key";

  const clerkKey = await createClerkApiKey(c.env, {
    subject: gate.identity.subject,
    name: keyName,
    description: `Issued via device login for ${clientLabel}`,
    scopes: ["trainfabric"],
    createdBy: gate.identity.subject,
  });
  if (clerkKey?.secret) {
    accessToken = clerkKey.secret;
    tokenType = "clerk_api_key";
  } else {
    const tf = await store.createTfApiKey({
      userId: gate.identity.subject,
      name: keyName,
      scopes: ["trainfabric"],
    });
    accessToken = tf.secret;
    tokenType = "tf_api_key";
  }

  const approved = await store.approve(userCode, {
    userId: gate.identity.subject,
    accessToken,
    tokenType,
  });
  if (!approved || approved.status !== "approved") {
    return c.json({ error: "Failed to approve device" }, 500);
  }

  return c.json({
    ok: true,
    status: "approved",
    token_type: tokenType,
    client_name: pending.client_name,
    // Never return the secret to the browser — CLI polls /auth/device/token.
  });
});

app.post("/auth/device/deny", async (c) => {
  const gate = requireClerkIdentity(c);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  const store = createApiKeyStore(c.env.DB);
  if (!store) return c.json({ error: "Auth store not configured" }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { user_code?: string };
  const userCode = body.user_code?.trim();
  if (!userCode) return c.json({ error: "user_code required" }, 400);
  const ok = await store.deny(userCode);
  if (!ok) return c.json({ error: "Unknown or already resolved code" }, 404);
  return c.json({ ok: true, status: "denied" });
});

/** Lookup pending device code metadata (dashboard preview). */
app.get("/auth/device/preview", async (c) => {
  const gate = requireClerkIdentity(c);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  const store = createApiKeyStore(c.env.DB);
  if (!store) return c.json({ error: "Auth store not configured" }, 503);
  const userCode = c.req.query("user_code")?.trim();
  if (!userCode) return c.json({ error: "user_code required" }, 400);
  const row = await store.getByUserCode(userCode);
  if (!row) return c.json({ error: "Unknown code" }, 404);
  return c.json({
    user_code: row.user_code,
    status: row.status,
    client_name: row.client_name,
    expires_at: row.expires_at,
    expired: Date.now() > row.expires_at,
  });
});

/** List Trainfabric-native API keys (tfak_*). Clerk ak_* are managed in Clerk UI. */
app.get("/auth/api-keys", async (c) => {
  const gate = requireClerkIdentity(c);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (gate.identity.subject === "anon") return c.json({ error: "Unauthorized" }, 401);
  const store = createApiKeyStore(c.env.DB);
  if (!store) return c.json({ error: "Auth store not configured" }, 503);
  const keys = await store.listTfApiKeys(gate.identity.subject);
  return c.json({ keys, clerk_api_keys: "Use dashboard User profile → API keys for Clerk keys (ak_*)" });
});

app.post("/auth/api-keys", async (c) => {
  const gate = requireClerkIdentity(c);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (gate.identity.subject === "anon") return c.json({ error: "Unauthorized" }, 401);
  const store = createApiKeyStore(c.env.DB);
  if (!store) return c.json({ error: "Auth store not configured" }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name?.trim() || `API key ${new Date().toISOString().slice(0, 10)}`).slice(0, 80);

  const clerkKey = await createClerkApiKey(c.env, {
    subject: gate.identity.subject,
    name,
    description: "Created from Trainfabric dashboard",
    scopes: ["trainfabric"],
    createdBy: gate.identity.subject,
  });
  if (clerkKey?.secret) {
    return c.json({
      id: clerkKey.id,
      name: clerkKey.name ?? name,
      secret: clerkKey.secret,
      token_type: "clerk_api_key",
      prefix: clerkKey.secret.slice(0, 12),
    });
  }

  const tf = await store.createTfApiKey({
    userId: gate.identity.subject,
    name,
    scopes: ["trainfabric"],
  });
  return c.json({
    id: tf.id,
    name,
    secret: tf.secret,
    token_type: "tf_api_key",
    prefix: tf.prefix,
  });
});

app.delete("/auth/api-keys/:id", async (c) => {
  const gate = requireClerkIdentity(c);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (gate.identity.subject === "anon") return c.json({ error: "Unauthorized" }, 401);
  const store = createApiKeyStore(c.env.DB);
  if (!store) return c.json({ error: "Auth store not configured" }, 503);
  const id = c.req.param("id");
  if (id.startsWith("ak_")) {
    return c.json(
      { error: "Revoke Clerk API keys from the Clerk API Keys UI in your profile" },
      400,
    );
  }
  const ok = await store.revokeTfApiKey(gate.identity.subject, id);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ---- Social identity profiles ----

/** Upsert the caller's own profile (dashboard syncs Clerk fields here). */
app.post("/profile", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ error: "Social store not configured" }, 503);
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity || identity.subject === "anon") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as UpsertProfileRequest;
    const isAgent = c.get("authVia") === "agent";
    const profile = await store.upsertProfile(identity.subject, {
      // Trust client-supplied Clerk fields for the authenticated subject only.
      displayName: body.displayName ?? identity.name,
      username: body.username ?? identity.username,
      imageUrl: body.imageUrl ?? identity.imageUrl,
      email: body.email ?? identity.email,
      bio: body.bio,
      isAgent,
    });
    return c.json({ profile });
  } catch (e) {
    return errResponse(e);
  }
});

/** Get the caller's own profile (provisioning from identity if absent). */
app.get("/profile", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ profile: null });
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity || identity.subject === "anon") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const profile =
      (await store.getProfile(identity.subject)) ??
      (await upsertProfileFromIdentity(store, identity, {
        isAgent: c.get("authVia") === "agent",
      }));
    return c.json({ profile });
  } catch (e) {
    return errResponse(e);
  }
});

/** Public profile lookup by subject id. */
app.get("/profile/:id", async (c) => {
  try {
    const store = createSocialStore(c.env);
    if (!store) return c.json({ profile: null });
    const profile = await store.getProfile(c.req.param("id"));
    if (!profile) return c.json({ error: "Not found" }, 404);
    return c.json({ profile });
  } catch (e) {
    return errResponse(e);
  }
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
    const registry = createRegistry(c.env);
    const identity = c.get("identity");
    const requestedOwner = c.req.query("owner");
    const rows = await registry.listDatasets({
      tag: c.req.query("tag"),
      search: c.req.query("search") ?? c.req.query("q"),
      owner: requestedOwner === "me" ? identity?.subject : requestedOwner,
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
    const deps = depsFrom(c);
    const datasets = (
      await Promise.all(
        connections.map(async (connection) => {
          const dataset = await deps.getDataset(connection.datasetId);
          if (!dataset) return null;
          try {
            const { authorizeDataset } = await import("./resolver");
            authorizeDataset(dataset, c.get("identity"));
            return dataset;
          } catch {
            return null;
          }
        }),
      )
    ).filter((dataset) => dataset !== null);
    return c.json({ connections, datasets });
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
    const authVia = c.get("authVia");
    // Ensure the caller has a profile so posts resolve a display identity.
    await upsertProfileFromIdentity(store, identity, { isAgent: authVia === "agent" });
    await store.ensureConnection(identity.subject, body.datasetId, "manual");
    const source = body.source ?? "user";
    const post = await store.createPost({
      authorId: identity.subject,
      // Humans resolve their name from the synced Clerk profile; agents may
      // pass an explicit label (e.g. "autoresearch").
      authorName: source === "agent" ? body.authorName : undefined,
      datasetId: body.datasetId,
      body: String(body.body).trim(),
      source,
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
    const raw = await store.listFeed({
      userId: identity?.subject,
      datasetId: c.req.query("datasetId") ?? undefined,
      limit: Number(c.req.query("limit") ?? 40),
    });
    const posts = await enrichPostsWithProfiles(store, raw);
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
    const [enriched] = await enrichPostsWithProfiles(store, [post]);
    return c.json({ post: enriched ?? post });
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

/* ── Trainfabric agent (Home ask box) ─────────────────────────────── */

function agentDoStub(env: Env, userId: string) {
  if (!env.TRAINFABRIC_AGENT_DO) throw new Error("TRAINFABRIC_AGENT_DO not bound");
  const id = env.TRAINFABRIC_AGENT_DO.idFromName(userId);
  return env.TRAINFABRIC_AGENT_DO.get(id);
}

app.post("/agent/sessions", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    if (!c.env.TRAINFABRIC_AGENT_DO) {
      return c.json({ error: "Trainfabric agent DO not configured" }, 503);
    }
    const stub = agentDoStub(c.env, gate.identity.subject);
    await stub.fetch("https://agent/clear", { method: "POST" });
    return c.json({ ok: true, sessionKey: gate.identity.subject });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/agent/messages", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    if (!c.env.TRAINFABRIC_AGENT_DO) {
      return c.json({ messages: [] });
    }
    const stub = agentDoStub(c.env, gate.identity.subject);
    const limit = c.req.query("limit") || "100";
    const res = await stub.fetch(`https://agent/messages?limit=${encodeURIComponent(limit)}`);
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/agent/messages/stream", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    if (!c.env.TRAINFABRIC_AGENT_DO) {
      return c.json({ error: "Trainfabric agent DO not configured" }, 503);
    }

    const body = (await c.req.json()) as {
      messages?: Array<{
        role: string;
        content?: unknown;
        parts?: Array<{ type: string; text?: string }>;
      }>;
      content?: unknown;
    };
    const content = extractChatUserContent(body);
    if (!content) return c.json({ error: "message required" }, 400);

    const stub = agentDoStub(c.env, gate.identity.subject);
    // Short window — home agent is an ephemeral shortcut, not a long archive.
    const histRes = await stub.fetch("https://agent/messages?limit=8");
    const histJson = (await histRes.json()) as { messages?: AgentStoredMessage[] };
    const prior = (histJson.messages ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
      .map((m) => ({
        ...m,
        content: m.content.length > 4000 ? `${m.content.slice(0, 4000)}…` : m.content,
      }));

    const userMsg: AgentStoredMessage = {
      id: `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      role: "user",
      content,
      createdAt: Date.now(),
    };
    await stub.fetch("https://agent/append", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(userMsg),
    });

    const mcp = buildMcpContext({
      env: c.env,
      get: () => gate.identity,
      req: { url: c.req.url },
      executionCtx: c.executionCtx,
    });

    const assistantId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    // Start SSE immediately; run the LLM turn while keepalives hold the connection.
    const replyPromise = (async () => {
      const replyText = await runTrainfabricAgentTurn(
        c.env,
        mcp,
        prior.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
        content.slice(0, 800),
        { maxSteps: 4 },
      );
      const assistantMsg: AgentStoredMessage = {
        id: assistantId,
        role: "assistant",
        content: replyText,
        createdAt: Date.now(),
      };
      await stub.fetch("https://agent/append", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(assistantMsg),
      });
      return replyText;
    })();

    return streamAiMessage(assistantId, replyPromise);
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
      source_auth?: "github" | "huggingface" | "none";
      installationId?: number;
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
      const sourceAuth = body.source_auth ?? "none";
      let remoteAuth: RemoteAuth = {};
      try {
        remoteAuth = await resolveConnectedRemoteAuth(c.env, identity, {
          sourceUrl,
          sourceAuth,
          installationId: body.installationId,
        });
      } catch (e) {
        if (e instanceof RemoteSourceError) {
          return c.json({ error: e.message }, e.status as 400);
        }
        throw e;
      }
      // Validate URL + list matching files before creating a dataset/job
      let listed: Awaited<ReturnType<typeof listRemoteFiles>>;
      try {
        parseSourceUrl(sourceUrl);
        listed = await listRemoteFiles(sourceUrl, remoteAuth);
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
      return await startRemoteIngest(c as never, identity, meta, sourceUrl, listed, remoteAuth);
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

/** Resolve GitHub App / HF OAuth tokens for connected remote pulls. */
async function resolveConnectedRemoteAuth(
  env: Env,
  identity: Identity,
  opts: {
    sourceUrl: string;
    sourceAuth: "github" | "huggingface" | "none";
    installationId?: number;
  },
): Promise<RemoteAuth> {
  if (opts.sourceAuth === "none") return {};

  if (opts.sourceAuth === "huggingface") {
    if (!hfConfigured(env)) {
      throw new RemoteSourceError("Hugging Face OAuth is not configured on the Worker", 503);
    }
    const store = createHfStore(env);
    const account = await store.getAccount(identity.subject);
    if (!account) {
      throw new RemoteSourceError("Connect Hugging Face first (Publish → Connect & pull)", 401);
    }
    const token = await decryptHfToken(account.accessTokenEnc, tokenCryptoKey(env));
    return { hfToken: token };
  }

  // github
  if (!githubConfigured(env)) {
    throw new RemoteSourceError("GitHub App is not configured on the Worker", 503);
  }
  const parsed = parseSourceUrl(opts.sourceUrl);
  if (parsed.kind !== "github") {
    throw new RemoteSourceError("source_auth=github requires a github.com URL", 400);
  }
  const ghStore = createGithubStore(env);
  let installationId = opts.installationId;

  if (installationId != null) {
    const inst = await ghStore.getInstallation(installationId);
    if (!inst || inst.userId !== identity.subject || inst.suspended) {
      throw new RemoteSourceError("GitHub installation not found for this account", 404);
    }
  } else {
    const installs = (await ghStore.listInstallations(identity.subject)).filter((i) => !i.suspended);
    if (!installs.length) {
      throw new RemoteSourceError("Connect GitHub first (Publish → Connect & pull)", 401);
    }
    const ownerLower = parsed.owner.toLowerCase();
    const preferred = [
      ...installs.filter((i) => i.accountLogin.toLowerCase() === ownerLower),
      ...installs.filter((i) => i.accountLogin.toLowerCase() !== ownerLower),
    ];
    let found: number | undefined;
    for (const inst of preferred) {
      try {
        const { token } = await createInstallationAccessToken(env, inst.installationId);
        const res = await fetch(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "trainfabric-router",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );
        if (res.ok) {
          found = inst.installationId;
          break;
        }
      } catch {
        /* try next */
      }
    }
    if (found == null) {
      throw new RemoteSourceError(
        `No connected GitHub installation can access ${parsed.owner}/${parsed.repo}. Install the App on that repo or make it public.`,
        403,
      );
    }
    installationId = found;
  }

  const { token } = await createInstallationAccessToken(env, installationId);
  return { githubToken: token };
}

/** List + download HF/GitHub files in the background, then ingest. */
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
  remoteAuth: RemoteAuth = {},
) {
  const datasetId = `ds_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const registry = createRegistry(c.env);
  const jobId = `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const bucket = c.env.R2_BUCKET ?? "trainfabric-data";

  const kindLabel = listed.kind === "hf" ? "Hugging Face" : "GitHub";

  await registry.createDataset({
    datasetId,
    owner: identity.subject,
    visibility: meta.visibility ?? "private",
    name: meta.name,
    description: meta.description,
    tags: [...(meta.tags ?? []), "remote-import", kindLabel === "Hugging Face" ? "huggingface" : "github"],
    kind: "base",
  });
  await registry.setJob({
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
        await registry.setJob({ jobId, status: "running", progress: 20 });
        const { stagingPath, fileCount } = await downloadRemoteToR2(
          c.env.R2,
          datasetId,
          listed.files,
          bucket,
          remoteAuth,
          listed.kind,
        );
        await registry.setJob({ jobId, status: "running", progress: 50 });

        // DO stub.fetch often ignores AbortSignal — race a hard timeout instead.
        const commitBody = JSON.stringify({
          action: "ingest",
          computeUrl: computeUrlFor(c.env),
          payload: {
            staging_path: stagingPath,
            dataset_id: datasetId,
            partition_hint: meta.partition_hint,
            sort_column: meta.sort_column,
          },
        });
        const res = await Promise.race([
          stub.fetch("https://catalog/commit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: commitBody,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "Ingest timed out waiting for compute (try again — cold start can take a minute)",
                  ),
                ),
              240_000,
            ),
          ),
        ]);
        await registry.setJob({ jobId, status: "running", progress: 75 });
        const json = (await res.json()) as {
          error?: string;
          schemaContract?: Record<string, unknown>;
          snapshotId?: string;
          icebergTable?: string;
          namespace?: string;
        };
        if (!res.ok || json.error) throw new Error(json.error ?? "ingest failed");
        await registry.updateAfterIngest({
          datasetId,
          snapshotId: json.snapshotId ?? "",
          rowCount: Number(json.schemaContract?.rowCount ?? 0),
          sizeBytes: Number(json.schemaContract?.sizeBytes ?? 0),
          schema: json.schemaContract,
          icebergNamespace: json.namespace,
          icebergTable: json.icebergTable,
        });
        await registry.setJob({
          jobId,
          status: "done",
          progress: 100,
          resultRef: `${json.snapshotId ?? ""}:${fileCount}files`,
        });

        const ds = (await registry.getDataset(datasetId)) as DatasetRecord;
        if (ds) {
          await upsertDatasetEmbedding(c.env.AI as never, c.env.VECTORIZE as never, ds);
        }
      } catch (e) {
        await registry.setJob({
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
  const registry = createRegistry(c.env);
  const jobId = `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  await registry.createDataset({
    datasetId,
    owner: identity.subject,
    visibility: meta.visibility ?? "private",
    name: meta.name,
    description: meta.description,
    tags: meta.tags ?? [],
    kind: "base",
  });
  await registry.setJob({
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
      await registry.setJob({ jobId, status: "running", progress: 10 });
      try {
        const commitBody = JSON.stringify({
          action: "ingest",
          computeUrl: computeUrlFor(c.env),
          payload: {
            staging_path: stagingPath,
            dataset_id: datasetId,
            partition_hint: meta.partition_hint,
            sort_column: meta.sort_column,
          },
        });
        const res = await Promise.race([
          stub.fetch("https://catalog/commit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: commitBody,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "Ingest timed out waiting for compute (try again — cold start can take a minute)",
                  ),
                ),
              240_000,
            ),
          ),
        ]);
        const json = (await res.json()) as {
          error?: string;
          schemaContract?: Record<string, unknown>;
          snapshotId?: string;
          icebergTable?: string;
          namespace?: string;
        };
        if (!res.ok || json.error) throw new Error(json.error ?? "ingest failed");
        await registry.updateAfterIngest({
          datasetId,
          snapshotId: json.snapshotId ?? "",
          rowCount: Number(json.schemaContract?.rowCount ?? 0),
          sizeBytes: Number(json.schemaContract?.sizeBytes ?? 0),
          schema: json.schemaContract,
          icebergNamespace: json.namespace,
          icebergTable: json.icebergTable,
        });
        await registry.setJob({ jobId, status: "done", progress: 100, resultRef: json.snapshotId });

        // Embed for semantic discovery
        const ds = (await registry.getDataset(datasetId)) as DatasetRecord;
        if (ds) {
          await upsertDatasetEmbedding(c.env.AI as never, c.env.VECTORIZE as never, ds);
        }
      } catch (e) {
        await registry.setJob({
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
    const registry = createRegistry(c.env);

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
    await registry.createDataset({
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
      await registry.setJob({ jobId, datasetId, kind: "materialize", status: "pending" });
      // Kick materialize via CatalogDO (runs first source query for MVP single-source)
      const doId = c.env.CATALOG_DO.idFromName(datasetId);
      const stub = c.env.CATALOG_DO.get(doId);
      const src = body.spec.sources[0];
      c.executionCtx.waitUntil(
        (async () => {
          await registry.setJob({ jobId: jobId!, status: "running" });
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
              await registry.updateAfterIngest({
                datasetId,
                snapshotId: json.snapshotId ?? "",
                rowCount: Number(json.schemaContract?.rowCount ?? 0),
                sizeBytes: Number(json.schemaContract?.sizeBytes ?? 0),
                schema: json.schemaContract,
                icebergNamespace: json.namespace,
                icebergTable: json.icebergTable,
              });
            }
            await registry.setJob({ jobId: jobId!, status: "done", progress: 100 });
          } catch (e) {
            await registry.setJob({
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
    const registry = createRegistry(c.env);
    const jobId = `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await registry.setJob({ jobId, datasetId: ds.id, kind: "rebuild", status: "pending" });
    return c.json({ jobId, status: "pending" });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/results/:hash", async (c) => {
  try {
    const registry = createRegistry(c.env);
    const entry = (await registry.lookupCache(c.req.param("hash"))) as {
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
    const registry = createRegistry(c.env);
    const job = await registry.getJob(c.req.param("id"));
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
    const origin = c.env.PUBLIC_API_URL || c.env.PUBLIC_API_BASE || new URL(c.req.url).origin;
    let githubToken: string | undefined;
    if (body.installationId && githubConfigured(c.env)) {
      const ghStore = createGithubStore(c.env);
      const inst = await ghStore.getInstallation(body.installationId);
      if (!inst || inst.userId !== identity.subject || inst.suspended) {
        return c.json({ error: "GitHub installation not found for this user" }, 403);
      }
      githubToken = (await createInstallationAccessToken(c.env, body.installationId)).token;
    }
    const run = await createAutoRun({
      store,
      box,
      datasetId: ds.id,
      ownerId: identity.subject,
      body,
      tfApiUrl: origin,
      apiKeys: createApiKeyStore(c.env.DB),
      campaignToken: c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") || undefined,
      githubToken,
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
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const deps = depsFrom(c);
    const ds = await deps.getDataset(c.req.param("id"));
    if (!ds) return c.json({ error: "Not found" }, 404);
    const { authorizeDataset } = await import("./resolver");
    authorizeDataset(ds, identity);
    const store = createAutoStore(c.env);
    // Only the caller's private agents on this dataset — never other users' runs.
    const runs = await store.listAutoRuns(ds.id, identity.subject);
    return c.json({ runs });
  } catch (e) {
    return errResponse(e);
  }
});

/* ── GitHub App ──────────────────────────────────────────────────── */

app.get("/github/status", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    const configured = githubConfigured(c.env);
    if (!configured) {
      return c.json({ configured: false, connected: false, installationCount: 0 });
    }
    const store = createGithubStore(c.env);
    const account = await store.getAccount(gate.identity.subject);
    // Installations are keyed by Clerk user even when user OAuth account row is missing
    // (e.g. App install without "Request user authorization during installation").
    let installs = (await store.listInstallations(gate.identity.subject)).filter(
      (i) => !i.suspended,
    );
    // Prune rows left behind when uninstall webhook was missed / misconfigured.
    const live: typeof installs = [];
    for (const inst of installs) {
      try {
        const exists = await installationExistsOnGithub(c.env, inst.installationId);
        if (exists) live.push(inst);
        else await store.deleteInstallation(inst.installationId);
      } catch {
        // Soft-fail: keep row if GitHub API is temporarily unavailable.
        live.push(inst);
      }
    }
    installs = live;
    if (account && installs.length === 0) {
      // OAuth account alone cannot clone/push — clear stale "connected" after uninstall.
      await store.deleteAccount(gate.identity.subject);
    }
    const connected = installs.length > 0;
    const login = installs[0]?.accountLogin ?? (connected ? account?.login : undefined);
    return c.json({
      configured: true,
      connected,
      login: connected ? login : undefined,
      avatarUrl: connected
        ? (installs[0]?.avatarUrl ?? account?.avatarUrl)
        : undefined,
      installationCount: installs.length,
    });
  } catch (e) {
    return errResponse(e);
  }
});

/** Returns { url } for the browser to navigate to GitHub App install. */
app.post("/github/install", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    if (!githubConfigured(c.env)) {
      return c.json({ error: "GitHub App is not configured on the Worker" }, 503);
    }
    const body = (await c.req.json().catch(() => ({}))) as { returnTo?: string };
    const returnTo = body.returnTo?.startsWith("/")
      ? body.returnTo
      : "/agents/new?github=connected";
    const state = await signInstallState(c.env, {
      userId: gate.identity.subject,
      returnTo,
    });
    return c.json({ url: buildConnectUrl(c.env, state) });
  } catch (e) {
    return errResponse(e);
  }
});

/** Browser redirect helper — same as POST but 302 when Authorization present. */
app.get("/github/install", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    if (!githubConfigured(c.env)) {
      return c.json({ error: "GitHub App is not configured on the Worker" }, 503);
    }
    const returnTo = c.req.query("returnTo")?.startsWith("/")
      ? c.req.query("returnTo")!
      : "/agents/new?github=connected";
    const state = await signInstallState(c.env, {
      userId: gate.identity.subject,
      returnTo,
    });
    return c.redirect(buildConnectUrl(c.env, state), 302);
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/github/callback", async (c) => {
  const dash = dashboardOrigin(c.env);
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const installationIdRaw = c.req.query("installation_id");
    const setupAction = c.req.query("setup_action");
    if (!state) {
      return c.redirect(`${dash}/agents/new?github=error&reason=missing_state`, 302);
    }
    const verified = await verifyInstallState(c.env, state);
    const store = createGithubStore(c.env);
    const now = Date.now();
    const cryptoKey = tokenCryptoKey(c.env);

    const installationIdFromQuery =
      installationIdRaw && setupAction !== "request" ? Number(installationIdRaw) : NaN;
    const installationId =
      Number.isFinite(installationIdFromQuery)
        ? installationIdFromQuery
        : verified.installationId != null && Number.isFinite(verified.installationId)
          ? verified.installationId
          : null;

    async function upsertInstallationFromApp(id: number): Promise<void> {
      const existing = await store.getInstallation(id);
      if (existing) {
        if (existing.userId !== verified.userId) {
          await store.upsertInstallation({
            ...existing,
            userId: verified.userId,
            updatedAt: now,
          });
        }
        return;
      }
      // App JWT is enough for installation metadata — do not require an install token.
      const appJwt = await createAppJwt(c.env);
      const meta = await fetch(`https://api.github.com/app/installations/${id}`, {
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "trainfabric-router",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!meta.ok) {
        const text = await meta.text();
        throw new Error(`installation_meta_${meta.status}:${text.slice(0, 80)}`);
      }
      const body = (await meta.json()) as {
        id: number;
        account?: { login: string; id: number; type: string; avatar_url?: string };
      };
      if (!body.account) throw new Error("installation_missing_account");
      await store.upsertInstallation({
        installationId: body.id,
        userId: verified.userId,
        accountLogin: body.account.login,
        accountType: body.account.type === "Organization" ? "Organization" : "User",
        accountId: body.account.id,
        avatarUrl: body.account.avatar_url,
        suspended: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (installationId != null) {
      await upsertInstallationFromApp(installationId);
    }

    if (code) {
      const { accessToken } = await exchangeOAuthCode(c.env, code);
      const ghUser = await getGithubUser(accessToken);
      await store.upsertAccount({
        userId: verified.userId,
        githubUserId: ghUser.id,
        login: ghUser.login,
        avatarUrl: ghUser.avatarUrl,
        userAccessTokenEnc: await encryptUserToken(accessToken, cryptoKey),
        createdAt: now,
        updatedAt: now,
      });
      const installs = await listUserInstallations(accessToken);
      for (const inst of installs) {
        await store.upsertInstallation({
          installationId: inst.installationId,
          userId: verified.userId,
          accountLogin: inst.accountLogin,
          accountType: inst.accountType,
          accountId: inst.accountId,
          avatarUrl: inst.avatarUrl,
          suspended: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Authorized but App not installed yet → send them to install.
      const linked = (await store.listInstallations(verified.userId)).filter((i) => !i.suspended);
      if (linked.length === 0) {
        const installState = await signInstallState(c.env, {
          userId: verified.userId,
          returnTo: verified.returnTo,
        });
        return c.redirect(buildInstallUrl(c.env, installState), 302);
      }
    } else if (installationId != null) {
      // Install finished without user OAuth — complete identity if missing.
      const account = await store.getAccount(verified.userId);
      if (!account) {
        const oauthState = await signInstallState(c.env, {
          userId: verified.userId,
          returnTo: verified.returnTo,
          installationId,
        });
        return c.redirect(buildUserOAuthUrl(c.env, oauthState), 302);
      }
    } else {
      return c.redirect(
        `${dash}/agents/new?github=error&reason=${encodeURIComponent("missing_oauth_code")}`,
        302,
      );
    }

    const account = await store.getAccount(verified.userId);
    const linkedInstalls = await store.listInstallations(verified.userId);
    if (!account && linkedInstalls.length === 0) {
      return c.redirect(
        `${dash}/agents/new?github=error&reason=${encodeURIComponent("link_incomplete")}`,
        302,
      );
    }

    const dest = verified.returnTo.startsWith("http")
      ? verified.returnTo
      : `${dash}${verified.returnTo.startsWith("/") ? "" : "/"}${verified.returnTo}`;
    const sep = dest.includes("?") ? "&" : "?";
    return c.redirect(`${dest}${sep}github=connected`, 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "callback_failed";
    return c.redirect(
      `${dash}/agents/new?github=error&reason=${encodeURIComponent(msg.slice(0, 120))}`,
      302,
    );
  }
});

app.post("/github/webhook", async (c) => {
  try {
    const raw = await c.req.text();
    const secret = c.env.GITHUB_APP_WEBHOOK_SECRET?.trim();
    if (secret) {
      const ok = await verifyWebhookSignature(
        secret,
        raw,
        c.req.header("x-hub-signature-256"),
      );
      if (!ok) return c.json({ error: "Invalid signature" }, 401);
    }
    const event = c.req.header("x-github-event") || "";
    const payload = JSON.parse(raw || "{}") as {
      action?: string;
      installation?: { id: number; suspended_at?: string | null };
    };
    const store = createGithubStore(c.env);
    if (event === "installation" && payload.installation?.id) {
      const id = payload.installation.id;
      if (payload.action === "deleted") {
        const existing = await store.getInstallation(id);
        await store.deleteInstallation(id);
        if (existing) {
          const remaining = await store.listInstallations(existing.userId);
          if (remaining.length === 0) {
            await store.deleteAccount(existing.userId);
          }
        }
      } else if (payload.action === "suspend") {
        await store.setInstallationSuspended(id, true);
      } else if (payload.action === "unsuspend") {
        await store.setInstallationSuspended(id, false);
      }
    }
    return c.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/github/installations", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    const store = createGithubStore(c.env);
    const installs = (await store.listInstallations(gate.identity.subject)).filter(
      (i) => !i.suspended,
    );
    return c.json({
      installations: installs.map((i) => ({
        installationId: i.installationId,
        accountLogin: i.accountLogin,
        accountType: i.accountType,
        accountId: i.accountId,
        avatarUrl: i.avatarUrl,
      })),
    });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/github/installations/:id/repos", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    if (!githubConfigured(c.env)) {
      return c.json({ error: "GitHub App is not configured" }, 503);
    }
    const installationId = Number(c.req.param("id"));
    if (!Number.isFinite(installationId)) return c.json({ error: "Invalid installation id" }, 400);
    const store = createGithubStore(c.env);
    const inst = await store.getInstallation(installationId);
    if (!inst || inst.userId !== gate.identity.subject) {
      return c.json({ error: "Installation not found" }, 404);
    }
    const page = Number(c.req.query("page") || "1");
    const all = c.req.query("all") !== "0";
    const out = await listInstallationRepos(c.env, installationId, {
      page: Number.isFinite(page) ? page : 1,
      perPage: 100,
      allPages: all,
    });
    return c.json({
      repos: out.repos,
      totalCount: out.totalCount,
      repositorySelection: out.repositorySelection,
    });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/github/repos", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    if (!githubConfigured(c.env)) {
      return c.json({ error: "GitHub App is not configured" }, 503);
    }
    const body = (await c.req.json()) as CreateGithubRepoRequest;
    if (!body.installationId || !body.name?.trim()) {
      return c.json({ error: "installationId and name required" }, 400);
    }
    const store = createGithubStore(c.env);
    const inst = await store.getInstallation(body.installationId);
    if (!inst || inst.userId !== gate.identity.subject || inst.suspended) {
      return c.json({ error: "Installation not found" }, 404);
    }
    let userAccessToken: string | undefined;
    if (inst.accountType === "User") {
      const account = await store.getAccount(gate.identity.subject);
      if (!account?.userAccessTokenEnc) {
        return c.json(
          {
            error:
              "Reconnect GitHub to create a personal repo. App install admin rights alone cannot create repos under your user — we need your user OAuth token from Connect.",
          },
          400,
        );
      }
      userAccessToken = await decryptUserToken(account.userAccessTokenEnc, tokenCryptoKey(c.env));
    }
    const created = await createRepoUnderInstallation(c.env, {
      installationId: body.installationId,
      accountLogin: inst.accountLogin,
      accountType: inst.accountType,
      name: body.name,
      private: body.private,
      description: body.description,
      defaultBranch: body.defaultBranch,
      userAccessToken,
    });
    return c.json(
      {
        fullName: created.fullName,
        htmlUrl: created.htmlUrl,
        cloneUrl: created.cloneUrl,
        defaultBranch: created.defaultBranch,
        installationId: body.installationId,
        githubRepoId: created.id,
        private: created.private,
      },
      201,
    );
  } catch (e) {
    return errResponse(e);
  }
});

app.delete("/github/connection", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    const store = createGithubStore(c.env);
    await store.deleteInstallationsForUser(gate.identity.subject);
    await store.deleteAccount(gate.identity.subject);
    return c.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/github/installations/:id/tree", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    if (!githubConfigured(c.env)) {
      return c.json({ error: "GitHub App is not configured" }, 503);
    }
    const installationId = Number(c.req.param("id"));
    if (!Number.isFinite(installationId)) return c.json({ error: "Invalid installation id" }, 400);
    const owner = c.req.query("owner")?.trim();
    const repo = c.req.query("repo")?.trim();
    if (!owner || !repo) return c.json({ error: "owner and repo required" }, 400);
    const store = createGithubStore(c.env);
    const inst = await store.getInstallation(installationId);
    if (!inst || inst.userId !== gate.identity.subject) {
      return c.json({ error: "Installation not found" }, 404);
    }
    const out = await listInstallationRepoTree(c.env, installationId, {
      owner,
      repo,
      ref: c.req.query("ref") || undefined,
      path: c.req.query("path") || undefined,
      recursive: c.req.query("recursive") === "1",
    });
    return c.json(out);
  } catch (e) {
    return errResponse(e);
  }
});

/** Whether the repo has a real TRAINFABRIC.md / AGENTS.md research brief (not starter stub). */
app.get("/github/research-brief", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    const owner = c.req.query("owner")?.trim();
    const repo = c.req.query("repo")?.trim();
    if (!owner || !repo) return c.json({ error: "owner and repo required" }, 400);
    const ref = c.req.query("ref")?.trim() || undefined;
    const installationIdRaw = c.req.query("installationId");
    const installationId = installationIdRaw ? Number(installationIdRaw) : NaN;

    if (Number.isFinite(installationId) && githubConfigured(c.env)) {
      const store = createGithubStore(c.env);
      const inst = await store.getInstallation(installationId);
      if (!inst || inst.userId !== gate.identity.subject) {
        return c.json({ error: "Installation not found" }, 404);
      }
      const out = await inspectInstallationResearchBrief(c.env, installationId, {
        owner,
        repo,
        ref,
      });
      return c.json(out);
    }

    const out = await inspectPublicResearchBrief({ owner, repo, ref });
    return c.json(out);
  } catch (e) {
    return errResponse(e);
  }
});

/** Expand a short draft into a TRAINFABRIC.md-style research brief. */
app.post("/auto/goal/enrich", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    const body = (await c.req.json()) as {
      draft?: string;
      repoFullName?: string;
      metric?: string;
    };
    const draft = body.draft?.trim() || "";
    if (draft.length < 8) return c.json({ error: "draft required (min 8 chars)" }, 400);
    const goal = await enrichResearchGoal(c.env, draft, {
      repoFullName: body.repoFullName?.trim(),
      metric: body.metric?.trim(),
    });
    return c.json({ goal });
  } catch (e) {
    return errResponse(e);
  }
});

/* ── Hugging Face OAuth ──────────────────────────────────────────── */

app.get("/huggingface/status", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    const configured = hfConfigured(c.env);
    if (!configured) {
      return c.json({ configured: false, connected: false });
    }
    const store = createHfStore(c.env);
    const account = await store.getAccount(gate.identity.subject);
    return c.json({
      configured: true,
      connected: Boolean(account),
      login: account?.login,
      avatarUrl: account?.avatarUrl,
    });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/huggingface/connect", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    if (!hfConfigured(c.env)) {
      return c.json({ error: "Hugging Face OAuth is not configured on the Worker" }, 503);
    }
    const body = (await c.req.json().catch(() => ({}))) as { returnTo?: string };
    const returnTo = body.returnTo?.startsWith("/") ? body.returnTo : "/new";
    const state = await signHfOAuthState(c.env, {
      userId: gate.identity.subject,
      returnTo,
    });
    return c.json({ url: buildHfConnectUrl(c.env, state) });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/huggingface/connect", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    if (!hfConfigured(c.env)) {
      return c.json({ error: "Hugging Face OAuth is not configured on the Worker" }, 503);
    }
    const returnTo = c.req.query("returnTo")?.startsWith("/")
      ? c.req.query("returnTo")!
      : "/new";
    const state = await signHfOAuthState(c.env, {
      userId: gate.identity.subject,
      returnTo,
    });
    return c.redirect(buildHfConnectUrl(c.env, state), 302);
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/huggingface/callback", async (c) => {
  const dash = hfDashboardOrigin(c.env);
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const err = c.req.query("error");
    if (err) {
      return c.redirect(
        `${dash}/new?huggingface=error&reason=${encodeURIComponent(err)}`,
        302,
      );
    }
    if (!code || !state) {
      return c.redirect(`${dash}/new?huggingface=error&reason=missing_code`, 302);
    }
    const verified = await verifyHfOAuthState(c.env, state);
    const tokens = await exchangeHfOAuthCode(c.env, code);
    const user = await getHfUser(tokens.accessToken);
    const now = Date.now();
    const cryptoKey = tokenCryptoKey(c.env);
    const store = createHfStore(c.env);
    await store.upsertAccount({
      userId: verified.userId,
      hfSub: user.sub,
      login: user.preferredUsername || user.name || user.sub,
      avatarUrl: user.picture,
      accessTokenEnc: await encryptHfToken(tokens.accessToken, cryptoKey),
      refreshTokenEnc: tokens.refreshToken
        ? await encryptHfToken(tokens.refreshToken, cryptoKey)
        : undefined,
      tokenExpiresAt: tokens.expiresIn ? now + tokens.expiresIn * 1000 : undefined,
      createdAt: now,
      updatedAt: now,
    });
    const returnTo = verified.returnTo?.startsWith("/") ? verified.returnTo : "/new";
    const sep = returnTo.includes("?") ? "&" : "?";
    return c.redirect(`${dash}${returnTo}${sep}huggingface=connected`, 302);
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 80) : "callback_failed";
    return c.redirect(
      `${dash}/new?huggingface=error&reason=${encodeURIComponent(reason)}`,
      302,
    );
  }
});

app.delete("/huggingface/connection", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    const store = createHfStore(c.env);
    await store.deleteAccount(gate.identity.subject);
    return c.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/huggingface/datasets", async (c) => {
  try {
    const gate = requireClerkIdentity(c);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);
    if (!hfConfigured(c.env)) {
      return c.json({ error: "Hugging Face OAuth is not configured" }, 503);
    }
    const store = createHfStore(c.env);
    const account = await store.getAccount(gate.identity.subject);
    if (!account) return c.json({ error: "Connect Hugging Face first" }, 401);
    const token = await decryptHfToken(account.accessTokenEnc, tokenCryptoKey(c.env));
    const search = c.req.query("search") || undefined;
    const authorParam = c.req.query("author");
    const datasets = await listHfDatasets(token, {
      search,
      author: authorParam !== undefined ? authorParam || undefined : search ? undefined : account.login,
      limit: Number(c.req.query("limit") || "50"),
    });
    return c.json({ datasets, login: account.login });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const body = (await c.req.json()) as CreateAutoRunRequest;
    const datasetIds = [
      ...(Array.isArray(body.datasetIds) ? body.datasetIds : []),
      body.datasetId,
    ].filter((id): id is string => Boolean(id && String(id).trim()));
    const uniqueIds = [...new Set(datasetIds.map((id) => String(id).trim()))];
    if (uniqueIds.length) {
      const deps = depsFrom(c);
      const { authorizeDataset } = await import("./resolver");
      for (const id of uniqueIds) {
        const ds = await deps.getDataset(id);
        if (ds) authorizeDataset(ds, identity);
      }
    }
    const store = createAutoStore(c.env);
    const box = boxClientFromEnv(c.env);
    const origin = c.env.PUBLIC_API_URL || c.env.PUBLIC_API_BASE || new URL(c.req.url).origin;
    let githubToken: string | undefined;
    if (body.installationId && githubConfigured(c.env)) {
      const ghStore = createGithubStore(c.env);
      const inst = await ghStore.getInstallation(body.installationId);
      if (!inst || inst.userId !== identity.subject || inst.suspended) {
        return c.json({ error: "GitHub installation not found for this user" }, 403);
      }
      const minted = await createInstallationAccessToken(c.env, body.installationId);
      githubToken = minted.token;
    }
    const run = await createAutoRun({
      store,
      box,
      datasetId: uniqueIds[0],
      ownerId: identity.subject,
      body: { ...body, datasetIds: uniqueIds, datasetId: uniqueIds[0] },
      tfApiUrl: origin,
      apiKeys: createApiKeyStore(c.env.DB),
      campaignToken: c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") || undefined,
      githubToken,
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
    const box = boxClientFromEnv(c.env);
    const apiKeys = createApiKeyStore(c.env.DB);
    const listed = await store.listAutoRunsByOwner(identity.subject);
    const runs = await Promise.all(
      listed.map((run) => reconcileAutoRunLiveness({ store, run, box, apiKeys })),
    );
    return c.json({
      runs,
      prerequisites: {
        boxConfigured: Boolean(c.env.BOX_API_KEY),
        boxTemplateConfigured: Boolean(c.env.BOX_TEMPLATE_ID),
        modalConfigured: Boolean(c.env.MODAL_TOKEN && c.env.MODAL_APP_REF),
        note: c.env.BOX_API_KEY
          ? c.env.BOX_TEMPLATE_ID
            ? "Box API key + golden template are set — new agents fork BOX_TEMPLATE_ID."
            : "BOX_API_KEY is set but BOX_TEMPLATE_ID is missing — run scripts/box-golden-bootstrap.mjs and put the secret."
          : "No BOX_API_KEY on the Worker — agents start in stub mode (control plane only). Set BOX_API_KEY + BOX_TEMPLATE_ID for live Box sandboxes.",
      },
    });
  } catch (e) {
    return errResponse(e);
  }
});

/** Account-wide GPU jobs (AutoTrials across AutoRuns) — Trainfabric GPU + self-hosted runners. */
app.get("/gpu/jobs", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const runs = await store.listAutoRunsByOwner(identity.subject);
    const statusFilter = (c.req.query("status") || "").trim().toLowerCase();
    const providerFilter = (c.req.query("provider") || "").trim().toLowerCase();
    const jobs = (
      await Promise.all(
        runs.map(async (run) => {
          const trials = await store.listAutoTrials(run.id);
          const provider =
            run.compute.provider === "modal" ? "trainfabric_gpu" : run.compute.provider;
          const repo =
            run.repo.fullName ||
            run.repo.url
              .replace(/^https?:\/\/(www\.)?github\.com\//, "")
              .replace(/\.git$/, "");
          return trials.map((t) => ({
            id: t.id,
            autoRunId: run.id,
            status: t.status,
            score: t.score,
            kept: t.kept,
            commitSha: t.commitSha,
            error: t.error,
            externalId: t.externalId,
            provider,
            runnerId: run.compute.runnerId,
            repo,
            repoUrl: run.repo.url,
            metric: run.protocol.metric.name,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          }));
        }),
      )
    )
      .flat()
      .filter((j) => (statusFilter ? j.status === statusFilter : true))
      .filter((j) => {
        if (!providerFilter) return true;
        if (providerFilter === "modal") return j.provider === "trainfabric_gpu";
        return j.provider === providerFilter;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return c.json({ jobs, count: jobs.length });
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/auto/:id", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    const store = createAutoStore(c.env);
    let run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
    const box = boxClientFromEnv(c.env);
    run = await reconcileAutoRunLiveness({
      store,
      run,
      box,
      apiKeys: createApiKeyStore(c.env.DB),
    });
    const [trials, activity, messages] = await Promise.all([
      store.listAutoTrials(run.id),
      store.listActivity(run.id).catch(() => []),
      store.listMessages(run.id).catch(() => []),
    ]);
    let events: unknown[] = [];
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
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
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
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
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
      boundBy: c.get("authVia") === "agent" ? "agent" : "user",
    });
    return c.json(next);
  } catch (e) {
    return errResponse(e);
  }
});

app.get("/auto/:id/messages", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
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
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
    const body = (await c.req.json()) as PostAutoMessageRequest;
    const out = await postAutoMessage({
      store,
      box: boxClientFromEnv(c.env),
      run,
      content: String(body.content ?? ""),
      role: body.role,
      source: body.source ?? "api",
      meta: body.meta,
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
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
    const body = (await c.req.json()) as {
      messages?: Array<{ role: string; content?: unknown; parts?: Array<{ type: string; text?: string }> }>;
      content?: unknown;
    };
    // useChat sends the full message list; take the last user message.
    const content = extractChatUserContent(body);
    const out = await postAutoMessage({
      store,
      box: boxClientFromEnv(c.env),
      run,
      content,
      source: "dashboard",
    });
    const assistant = out.assistantMessage;
    if (!assistant) {
      return c.json({ error: "No assistant reply" }, 500);
    }
    return streamAiMessage(assistant.id, assistant.content);
  } catch (e) {
    return errResponse(e);
  }
});

/** Mint a short-lived installation token for daemon/GPU git auth. */
app.post("/auto/:id/github-credentials", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    if (!githubConfigured(c.env)) {
      return c.json({ error: "GitHub App is not configured" }, 503);
    }
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
    const installationId = run.repo.installationId;
    if (!installationId) {
      return c.json({ error: "AutoRun has no GitHub installation bound" }, 400);
    }
    const ghStore = createGithubStore(c.env);
    const inst = await ghStore.getInstallation(installationId);
    if (!inst || inst.suspended) {
      return c.json({ error: "GitHub installation unavailable" }, 404);
    }
    // Owner or campaign token for this run's owner.
    if (inst.userId !== run.ownerId) {
      return c.json({ error: "Installation ownership mismatch" }, 403);
    }
    const minted = await createInstallationAccessToken(c.env, installationId);
    const fullName =
      run.repo.fullName ||
      run.repo.url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
    return c.json({
      token: minted.token,
      expiresAt: minted.expiresAt,
      cloneUrl: authenticatedCloneUrl(minted.token, fullName),
      fullName,
    });
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto/:id/heartbeat", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
    const body = (await c.req.json().catch(() => ({}))) as {
      phase?: string;
      message?: string;
      trial?: number;
      meta?: Record<string, unknown>;
    };
    const next = await heartbeatAutoRun({ store, run, body });
    return c.json(next);
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
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
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
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
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
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
    const next = await cancelAutoRun(store, boxClientFromEnv(c.env), run, createApiKeyStore(c.env.DB));
    return c.json(next);
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/auto/:id/trials", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    const store = createAutoStore(c.env);
    const run = await store.getAutoRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const denied = requireAutoRunOwner(run, identity);
    if (denied) return denied;
    if (run.status !== "running") return c.json({ error: `run is ${run.status}` }, 409);
    const body = (await c.req.json().catch(() => ({}))) as {
      hypothesis?: string;
      commitSha?: string;
      dataSpec?: {
        uri: string;
        endpoint_url?: string;
        format?: string;
        region?: string;
        size_bytes?: number;
        estimated_bytes?: number;
        cluster?: boolean;
      };
      estimatedBytes?: number;
      gpuNodes?: number;
    };
    const origin = c.env.PUBLIC_API_URL || c.env.PUBLIC_API_BASE || new URL(c.req.url).origin;
    let githubToken: string | undefined;
    if (run.repo.installationId && githubConfigured(c.env)) {
      try {
        githubToken = (
          await createInstallationAccessToken(c.env, run.repo.installationId)
        ).token;
      } catch {
        /* public clone fallback */
      }
    }
    const trial = await enqueueTrial({
      store,
      run,
      hypothesis: body.hypothesis,
      commitSha: body.commitSha,
      dataSpec: body.dataSpec,
      estimatedBytes: body.estimatedBytes,
      gpuNodes: body.gpuNodes,
      callbackBaseUrl: origin,
      githubToken,
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

    const identity = identityOrAnon(c.get("identity"), c.env);
    const runner = await authRunner(store, c.req.header("Authorization"));
    const completionSecret =
      c.env.AGENT_TOKEN_SECRET?.trim() ||
      c.env.GITHUB_TOKEN_CRYPTO_KEY?.trim() ||
      "dev-trial-completion-secret";
    const sigOk = await verifyTrialCompletion(
      completionSecret,
      run.id,
      trial.id,
      c.req.query("sig"),
    );
    const ownerOk = ownsAutoRun(run, identity);
    const runnerOk = Boolean(runner && runner.ownerId === run.ownerId);
    if (!sigOk && !ownerOk && !runnerOk) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = (await c.req.json()) as CompleteAutoTrialRequest;
    const out = await completeTrial({ store, run, trial, body, apiKeys: createApiKeyStore(c.env.DB) });
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
    const trial = await store.claimPendingTrial(runner.ownerId);
    if (!trial) return c.json({ trial: null });
    const run = await store.getAutoRun(trial.autoRunId);
    if (!run || run.ownerId !== runner.ownerId) {
      return c.json({ trial: null });
    }
    let cloneUrl: string | undefined;
    if (run?.repo.installationId && githubConfigured(c.env)) {
      try {
        const minted = await createInstallationAccessToken(c.env, run.repo.installationId);
        const fullName =
          run.repo.fullName ||
          run.repo.url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
        cloneUrl = authenticatedCloneUrl(minted.token, fullName);
      } catch {
        /* public clone fallback */
      }
    }
    return c.json({ trial, run, cloneUrl });
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
    if (result.costTier !== "A" || !("manifest" in result) || !result.manifest) {
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
  executionCtx?: { waitUntil: (p: Promise<unknown>) => void };
}): McpContext {
  const deps = depsFrom(c);
  const registry = createRegistry(c.env);
  const hasCompute = Boolean(c.env.COMPUTE || c.env.COMPUTE_URL);
  const compute = hasCompute ? createComputeClientFromEnv(c.env) : null;
  const identity = c.get("identity");
  const waitUntil =
    c.executionCtx?.waitUntil?.bind(c.executionCtx) ??
    ((p: Promise<unknown>) => {
      void p;
    });
  const ingestCtx = { env: c.env, executionCtx: { waitUntil } };

  return {
    identity,
    deps,
    listDatasets: async (opts) =>
      (await registry.listDatasets({
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
      const meta = {
        name: String(args.name),
        description: args.description as string | undefined,
        tags: (args.tags as string[]) ?? [],
        visibility: (args.visibility as Visibility) ?? "private",
        partition_hint: args.partition_hint as string | undefined,
        sort_column: args.sort_column as string | undefined,
      };
      // Prefer source_url; also accept HF/GitHub URLs mistakenly passed as data_ref.
      const rawRef = args.data_ref != null ? String(args.data_ref).trim() : "";
      const looksRemote =
        /^https?:\/\//i.test(rawRef) &&
        /(huggingface\.co|hf\.co|github\.com)/i.test(rawRef);
      const sourceUrl =
        (args.source_url != null ? String(args.source_url).trim() : "") ||
        (looksRemote ? rawRef : "");
      if (sourceUrl) {
        if (!identity) throw new Error("Auth required");
        const sourceAuth =
          (args.source_auth as "github" | "huggingface" | "none" | undefined) ?? "none";
        const remoteAuth = await resolveConnectedRemoteAuth(c.env, identity, {
          sourceUrl,
          sourceAuth,
          installationId:
            args.installationId != null ? Number(args.installationId) : undefined,
        });
        const listed = await listRemoteFiles(sourceUrl, remoteAuth);
        const res = await startRemoteIngest(
          ingestCtx as never,
          identity,
          meta,
          sourceUrl,
          listed,
          remoteAuth,
        );
        const json = (await res.json()) as { datasetId: string; jobId: string };
        return { datasetId: json.datasetId, jobId: json.jobId };
      }
      if (!args.data_ref) throw new Error("data_ref or source_url required");
      // Staged R2/local path — same durable waitUntil path as REST ingest.
      if (!identity) throw new Error("Auth required");
      const res = await startIngest(
        ingestCtx as never,
        identity,
        meta,
        String(args.data_ref),
      );
      const json = (await res.json()) as { datasetId: string; jobId: string };
      return { datasetId: json.datasetId, jobId: json.jobId };
    },
    getJob: (id) => registry.getJob(id),
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
      await registry.createDataset({
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
      // Agents (MCP/CLI/autorunner) get an auto-provisioned profile so their
      // posts carry a stable identity across the feed.
      await upsertProfileFromIdentity(store, identity, {
        isAgent: true,
        fallbackName: args.authorName,
      });
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
      const raw = await store.listFeed({ userId: identity?.subject, limit });
      return enrichPostsWithProfiles(store, raw);
    },
    listConnections: async () => {
      const store = createSocialStore(c.env);
      if (!store || !identity) return [];
      return store.listConnections(identity.subject);
    },
    startAuto: async (args) => {
      if (!identity) throw new AuthError("Auth required");
      const store = createAutoStore(c.env);
      const origin = c.env.PUBLIC_API_URL || c.env.PUBLIC_API_BASE || new URL(c.req.url).origin;
      let githubToken: string | undefined;
      if (args.installation_id && githubConfigured(c.env)) {
        const ghStore = createGithubStore(c.env);
        const inst = await ghStore.getInstallation(args.installation_id);
        if (!inst || inst.userId !== identity.subject || inst.suspended) {
          throw new AuthError("GitHub installation not found for this user");
        }
        githubToken = (await createInstallationAccessToken(c.env, args.installation_id)).token;
      }
      return createAutoRun({
        store,
        box: boxClientFromEnv(c.env),
        datasetId: args.dataset_id ?? args.dataset_ids?.[0],
        ownerId: identity.subject,
        body: {
          goal: args.goal,
          repoUrl: args.repo_url,
          repoFullName: args.repo_full_name,
          installationId: args.installation_id,
          defaultBranch: args.default_branch,
          datasetId: args.dataset_id ?? args.dataset_ids?.[0],
          datasetIds: args.dataset_ids,
          protocol: args.protocol,
          compute: args.compute,
          templateId: args.template_id,
        },
        tfApiUrl: origin,
        apiKeys: createApiKeyStore(c.env.DB),
        githubToken,
        env: c.env,
      });
    },
    checkAuto: async (autoRunId) => {
      if (!identity) throw new AuthError("Auth required");
      const store = createAutoStore(c.env);
      const run = await store.getAutoRun(autoRunId);
      if (!run) throw new NotFoundError();
      if (!ownsAutoRun(run, identity)) throw new NotFoundError();
      const [trials, activity] = await Promise.all([
        store.listAutoTrials(run.id),
        store.listActivity(run.id).catch(() => []),
      ]);
      return { run, trials, activity, boundDatasets: run.boundDatasets ?? [] };
    },
    listAutoRuns: async (datasetId) => {
      if (!identity) throw new AuthError("Auth required");
      const store = createAutoStore(c.env);
      return store.listAutoRuns(datasetId, identity.subject);
    },
    pauseAuto: async (autoRunId, action = "pause") => {
      if (!identity) throw new AuthError("Auth required");
      const store = createAutoStore(c.env);
      const run = await store.getAutoRun(autoRunId);
      if (!run) throw new NotFoundError();
      if (!ownsAutoRun(run, identity)) throw new NotFoundError();
      const box = boxClientFromEnv(c.env);
      if (action === "resume") return resumeAutoRun(store, box, run);
      if (action === "cancel") return cancelAutoRun(store, box, run, createApiKeyStore(c.env.DB));
      return pauseAutoRun(store, box, run);
    },
    bindAutoDataset: async (autoRunId, datasetId, reason) => {
      if (!identity) throw new AuthError("Auth required");
      const store = createAutoStore(c.env);
      const run = await store.getAutoRun(autoRunId);
      if (!run) throw new NotFoundError();
      if (!ownsAutoRun(run, identity)) throw new NotFoundError();
      const ds = await deps.getDataset(datasetId);
      if (!ds) throw new NotFoundError();
      authorizeDataset(ds, identity);
      const boundBy = c.get("authVia") === "agent" ? "agent" : "user";
      return bindDataset({
        store,
        run,
        body: { datasetId, snapshotId: ds.latestSnapshotId ?? undefined, reason },
        boundBy,
      });
    },
    messageAutoAgent: async (autoRunId, message) => {
      if (!identity) throw new AuthError("Auth required");
      const store = createAutoStore(c.env);
      const run = await store.getAutoRun(autoRunId);
      if (!run) throw new NotFoundError();
      if (!ownsAutoRun(run, identity)) throw new NotFoundError();
      return postAutoMessage({
        store,
        box: boxClientFromEnv(c.env),
        run,
        content: message,
        source: "mcp",
      });
    },
    listAutoMessages: async (autoRunId, limit) => {
      if (!identity) throw new AuthError("Auth required");
      const store = createAutoStore(c.env);
      const run = await store.getAutoRun(autoRunId);
      if (!run) throw new NotFoundError();
      if (!ownsAutoRun(run, identity)) throw new NotFoundError();
      const messages = await store.listMessages(run.id);
      return messages.slice(-Math.max(1, limit ?? 50));
    },
    registerGpuRunner: async (args) => {
      if (!identity) throw new AuthError("Auth required");
      const store = createAutoStore(c.env);
      const out = await registerRunner({
        store,
        ownerId: identity.subject,
        body: { name: args.name, capacity: args.capacity },
      });
      const api =
        c.env.PUBLIC_API_BASE ||
        c.env.PUBLIC_API_URL ||
        "https://trainfabric-router.rishabhspro.workers.dev";
      const docker_run = [
        "git clone https://github.com/cybertheory/trainfabric-gpu-runner.git && cd trainfabric-gpu-runner",
        "docker build -t trainfabric/gpu-runner .",
        `docker run --rm -e TF_API_URL=${api} -e RUNNER_TOKEN=${out.token} trainfabric/gpu-runner`,
      ].join(" && ");
      return {
        runnerId: out.runnerId,
        token: out.token,
        docker_run,
        docs: "https://github.com/cybertheory/trainfabric-gpu-runner",
      };
    },
    listGpuRunners: async () => {
      if (!identity) throw new AuthError("Auth required");
      const store = createAutoStore(c.env);
      const runners = await store.listAutoRunners(identity.subject);
      return runners.map((r) => ({
        id: r.id,
        name: r.name,
        capacity: r.capacity,
        lastHeartbeatAt: r.lastHeartbeatAt,
        createdAt: r.createdAt,
      }));
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
        const { identity: resolved } = await resolveBearerIdentity(req.headers.get("Authorization"), env);
        const identity = identityOrAnon(resolved, env);
        return buildMcpContext({
          env,
          get: () => identity,
          req: { url: req.url },
          executionCtx: ctx,
        });
      });
    }

    const isApi =
      path === "/health" ||
      path === "/auth/whoami" ||
      path.startsWith("/auth/") ||
      path.startsWith("/admin/") ||
      path.startsWith("/jobs/") ||
      path === "/auto" ||
      path.startsWith("/auto/") ||
      path === "/gpu/jobs" ||
      path.startsWith("/gpu/") ||
      path.startsWith("/github") ||
      path.startsWith("/huggingface") ||
      path.startsWith("/agent") ||
      path.startsWith("/runners") ||
      path.startsWith("/results/") ||
      path.startsWith("/r2/") ||
      path.startsWith("/social/") ||
      path === "/profile" ||
      path.startsWith("/profile/") ||
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
