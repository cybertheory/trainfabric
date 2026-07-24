import { Hono } from "hono";
import { cors } from "hono/cors";
import type { QueryRequest, Visibility } from "@trainfabric/shared";
import {
  resolveQuery,
  AuthError,
  NotFoundError,
  FilterValidationError,
  type DatasetRecord,
  type Identity,
  type ResolverDeps,
} from "./resolver";
import { createRegistry } from "./registry";
import {
  createComputeClientFromEnv,
  CONTAINER_COMPUTE,
} from "./compute";
import type { ComputeContainer } from "./ComputeContainer";
import { verifyClerkJwt } from "./auth";
import { publicResultUrl, putStaging, objectKeyFromUri } from "./r2";
import { MCP_TOOLS, handleMcpTool, type McpContext } from "./mcp";
import { decideMaterialization, detectCycle, visibilityAllowed } from "./derived";
import { upsertDatasetEmbedding } from "./discover";
import { CatalogDO } from "./CatalogDO";
import { WarmRouterDO } from "./WarmRouterDO";
import { ComputeContainer as ComputeContainerClass } from "./ComputeContainer";

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

type Variables = { identity: Identity | null };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"] }));

app.use("*", async (c, next) => {
  const identity = await verifyClerkJwt(c.req.header("Authorization"), {
    CLERK_JWT_ISSUER: c.env.CLERK_JWT_ISSUER,
    CLERK_JWT_AUDIENCE: c.env.CLERK_JWT_AUDIENCE,
  });
  c.set("identity", identity);
  await next();
});

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

app.get("/health", (c) =>
  c.json({
    status: "ok",
    registry: c.env.DB ? "d1" : "convex",
    compute: c.env.COMPUTE_URL ? "http" : c.env.COMPUTE ? "container" : "none",
  }),
);

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
    const body = (await c.req.json()) as Partial<QueryRequest>;
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
    return c.json(result);
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
    const fallbackRows = () => c.json({ rows: (ds.schema?.sampleRows ?? []).slice(0, n) });
    if (!(c.env.COMPUTE || c.env.COMPUTE_URL)) {
      return fallbackRows();
    }
    try {
      const compute = createComputeClientFromEnv(c.env);
      const rows = await compute.sample(
        ds.icebergTable ?? ds.id,
        n,
        ds.icebergNamespace ?? "default",
      );
      return c.json({ rows });
    } catch {
      return fallbackRows();
    }
  } catch (e) {
    return errResponse(e);
  }
});

app.post("/datasets", async (c) => {
  try {
    const identity = identityOrAnon(c.get("identity"), c.env);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);

    const contentType = c.req.header("content-type") ?? "";
    let meta: {
      name: string;
      description?: string;
      tags?: string[];
      visibility?: Visibility;
      partition_hint?: string;
      sort_column?: string;
    };
    let fileBytes: ArrayBuffer;
    let filename: string;

    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
      fileBytes = await file.arrayBuffer();
      filename = file.name;
      meta = {
        name: String(form.get("name") ?? file.name),
        description: form.get("description")?.toString(),
        tags: form.get("tags") ? String(form.get("tags")).split(",").map((t) => t.trim()) : [],
        visibility: (form.get("visibility")?.toString() as Visibility) ?? "private",
        partition_hint: form.get("partition_hint")?.toString(),
        sort_column: form.get("sort_column")?.toString(),
      };
    } else {
      const body = await c.req.json();
      meta = body;
      if (!body.staging_key && !body.data_ref) {
        return c.json({ error: "Provide multipart file or staging_key/data_ref" }, 400);
      }
      filename = body.filename ?? "data.bin";
      fileBytes = new ArrayBuffer(0);
      if (body.staging_key || body.data_ref) {
        // Already staged
        return await startIngest(c, identity, meta, String(body.staging_key ?? body.data_ref));
      }
    }

    const datasetId = `ds_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const stagingKey = await putStaging(c.env.R2, datasetId, filename, fileBytes, "application/octet-stream");
    // Pass as path the Worker can hand to compute — for Containers, use s3 URI
    const stagingPath = `s3://trainfabric-data/${stagingKey}`;
    return await startIngest(c, identity, meta, stagingPath, datasetId);
  } catch (e) {
    return errResponse(e);
  }
});

async function startIngest(
  c: { env: Env; executionCtx: ExecutionContext; json: Hono["json"] },
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

  return (c as unknown as { json: (b: unknown, s?: number) => Response }).json({
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
            const q = await compute.query({
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

// ---- MCP endpoint ----

app.get("/mcp/tools", (c) => c.json({ tools: MCP_TOOLS }));

app.post("/mcp", async (c) => {
  try {
    const body = (await c.req.json()) as {
      jsonrpc?: string;
      id?: string | number;
      method: string;
      params?: Record<string, unknown>;
    };

    // JSON-RPC style for remote MCP
    if (body.method === "tools/list" || body.method === "list_tools") {
      return c.json({ jsonrpc: "2.0", id: body.id, result: { tools: MCP_TOOLS } });
    }
    if (body.method === "tools/call" || body.method === "call_tool") {
      const params = body.params ?? {};
      const name = String(params.name ?? "");
      const args = (params.arguments ?? params.args ?? {}) as Record<string, unknown>;
      const ctx = buildMcpContext(c);
      const result = await handleMcpTool(name, args, ctx);
      return c.json({ jsonrpc: "2.0", id: body.id, result });
    }
    // Direct tool call shorthand
    if (body.method && MCP_TOOLS.some((t) => t.name === body.method)) {
      const ctx = buildMcpContext(c);
      const result = await handleMcpTool(body.method, body.params ?? {}, ctx);
      return c.json({ jsonrpc: "2.0", id: body.id, result });
    }
    return c.json(
      { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } },
      404,
    );
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
      if (!compute) return (ds?.schema?.sampleRows ?? []).slice(0, n);
      return compute.sample(id, n, ds?.icebergNamespace ?? "default");
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
    const isApi =
      path === "/health" ||
      path.startsWith("/admin/") ||
      path.startsWith("/jobs/") ||
      path.startsWith("/results/") ||
      path.startsWith("/mcp") ||
      path.startsWith("/r2/") ||
      path === "/datasets" ||
      path === "/datasets/derived" ||
      /^\/datasets\/[^/]+$/.test(path) ||
      /^\/datasets\/[^/]+\/(schema|snapshots|lineage|query|estimate|sample|rebuild)$/.test(path) ||
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
        },
        { status: path === "/" ? 200 : 404 },
      );
    }
    return app.fetch(request, env, ctx);
  },
};
