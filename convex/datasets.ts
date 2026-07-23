import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

async function identity(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) {
  return await ctx.auth.getUserIdentity();
}

function canRead(
  dataset: { visibility: string; owner: string },
  subject: string | undefined,
): boolean {
  if (dataset.visibility === "public") return true;
  return !!subject && dataset.owner === subject;
}

export const listPublicDatasets = query({
  args: {
    tag: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    let rows = await ctx.db
      .query("datasets")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .take(200);

    if (args.tag) {
      const tag = args.tag.toLowerCase();
      rows = rows.filter((d) => d.tags.some((t) => t.toLowerCase() === tag));
    }
    if (args.search) {
      const s = args.search.toLowerCase();
      rows = rows.filter(
        (d) =>
          d.name.toLowerCase().includes(s) ||
          d.description?.toLowerCase().includes(s) ||
          d.tags.some((t) => t.toLowerCase().includes(s)),
      );
    }
    return rows.slice(0, limit).map(toMeta);
  },
});

export const listMyDatasets = query({
  args: {},
  handler: async (ctx) => {
    const id = await identity(ctx);
    if (!id) return [];
    const rows = await ctx.db
      .query("datasets")
      .withIndex("by_owner", (q) => q.eq("owner", id.subject))
      .collect();
    return rows.map(toMeta);
  },
});

export const getDataset = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = await identity(ctx);
    const row = await ctx.db
      .query("datasets")
      .withIndex("by_datasetId", (q) => q.eq("datasetId", args.id))
      .unique();
    if (!row) return null;
    if (!canRead(row, id?.subject)) return null;
    return {
      ...toMeta(row),
      schema: row.schema,
      derivedSpec: row.derivedSpec,
      materializationDecision: row.materializationDecision,
      stale: row.stale,
      staleReason: row.staleReason,
      icebergNamespace: row.icebergNamespace,
      icebergTable: row.icebergTable,
    };
  },
});

export const getDatasetByOwnerName = query({
  args: { owner: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const id = await identity(ctx);
    const row = await ctx.db
      .query("datasets")
      .withIndex("by_owner_name", (q) => q.eq("owner", args.owner).eq("name", args.name))
      .unique();
    if (!row) return null;
    if (!canRead(row, id?.subject)) return null;
    return {
      ...toMeta(row),
      schema: row.schema,
      derivedSpec: row.derivedSpec,
      materializationDecision: row.materializationDecision,
      stale: row.stale,
      staleReason: row.staleReason,
    };
  },
});

export const getSchema = query({
  args: { id: v.string(), snapshot: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const id = await identity(ctx);
    const row = await ctx.db
      .query("datasets")
      .withIndex("by_datasetId", (q) => q.eq("datasetId", args.id))
      .unique();
    if (!row || !canRead(row, id?.subject)) return null;
    if (args.snapshot && args.snapshot !== row.latestSnapshotId) {
      const snap = await ctx.db
        .query("snapshots")
        .withIndex("by_snapshot", (q) => q.eq("snapshotId", args.snapshot!))
        .unique();
      return snap?.schema ?? null;
    }
    return row.schema ?? null;
  },
});

export const lookupCache = query({
  args: { queryHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("resultCache")
      .withIndex("by_queryHash", (q) => q.eq("queryHash", args.queryHash))
      .unique();
  },
});

export const getJob = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.id))
      .unique();
  },
});

export const listSnapshots = query({
  args: { datasetId: v.string() },
  handler: async (ctx, args) => {
    const id = await identity(ctx);
    const ds = await ctx.db
      .query("datasets")
      .withIndex("by_datasetId", (q) => q.eq("datasetId", args.datasetId))
      .unique();
    if (!ds || !canRead(ds, id?.subject)) return [];
    return await ctx.db
      .query("snapshots")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
  },
});

export const getLineage = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = await identity(ctx);
    const root = await ctx.db
      .query("datasets")
      .withIndex("by_datasetId", (q) => q.eq("datasetId", args.id))
      .unique();
    if (!root || !canRead(root, id?.subject)) return null;

    async function walk(datasetId: string, seen: Set<string>): Promise<{
      datasetId: string;
      name: string;
      kind: "base" | "derived";
      children: Awaited<ReturnType<typeof walk>>[];
    }> {
      if (seen.has(datasetId)) {
        return { datasetId, name: "(cycle)", kind: "derived", children: [] };
      }
      seen.add(datasetId);
      const d = await ctx.db
        .query("datasets")
        .withIndex("by_datasetId", (q) => q.eq("datasetId", datasetId))
        .unique();
      if (!d) {
        return { datasetId, name: "(missing)", kind: "base", children: [] };
      }
      const children = [];
      if (d.derivedSpec) {
        for (const src of d.derivedSpec.sources) {
          children.push(await walk(src.datasetId, new Set(seen)));
        }
      }
      return {
        datasetId: d.datasetId,
        name: d.name,
        kind: d.kind,
        children,
      };
    }

    return walk(args.id, new Set());
  },
});

export const listQueryHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const id = await identity(ctx);
    if (!id) return [];
    return await ctx.db
      .query("queryHistory")
      .withIndex("by_user", (q) => q.eq("userId", id.subject))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

// ---- Mutations ----

export const upsertUser = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        name: args.name,
      });
      return existing._id;
    }
    return await ctx.db.insert("users", args);
  },
});

export const createDatasetEntry = mutation({
  args: {
    datasetId: v.string(),
    owner: v.string(),
    visibility,
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.array(v.string()),
    kind: v.optional(kind),
    derivedSpec: v.optional(v.any()),
    materializationDecision: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const id = await identity(ctx);
    if (id && id.subject !== args.owner) {
      throw new Error("Forbidden: cannot create dataset for another user");
    }
    const now = Date.now();
    return await ctx.db.insert("datasets", {
      datasetId: args.datasetId,
      owner: args.owner,
      visibility: args.visibility,
      name: args.name,
      description: args.description,
      tags: args.tags,
      stars: 0,
      latestSnapshotId: "",
      rowCount: 0,
      sizeBytes: 0,
      kind: args.kind ?? "base",
      derivedSpec: args.derivedSpec,
      materializationDecision: args.materializationDecision,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateDatasetAfterIngest = mutation({
  args: {
    datasetId: v.string(),
    snapshotId: v.string(),
    rowCount: v.number(),
    sizeBytes: v.number(),
    schema: v.any(),
    icebergNamespace: v.optional(v.string()),
    icebergTable: v.optional(v.string()),
    parentSnapshotId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("datasets")
      .withIndex("by_datasetId", (q) => q.eq("datasetId", args.datasetId))
      .unique();
    if (!row) throw new Error("Dataset not found");
    const now = Date.now();
    await ctx.db.patch(row._id, {
      latestSnapshotId: args.snapshotId,
      rowCount: args.rowCount,
      sizeBytes: args.sizeBytes,
      schema: args.schema,
      icebergNamespace: args.icebergNamespace,
      icebergTable: args.icebergTable,
      updatedAt: now,
    });
    await ctx.db.insert("snapshots", {
      datasetId: args.datasetId,
      snapshotId: args.snapshotId,
      parentSnapshotId: args.parentSnapshotId,
      rowCount: args.rowCount,
      sizeBytes: args.sizeBytes,
      schema: args.schema,
      createdAt: now,
      branch: "main",
    });
  },
});

export const upsertCacheEntry = mutation({
  args: {
    queryHash: v.string(),
    datasetId: v.string(),
    snapshotId: v.string(),
    r2Url: v.string(),
    rowCount: v.number(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("resultCache")
      .withIndex("by_queryHash", (q) => q.eq("queryHash", args.queryHash))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        r2Url: args.r2Url,
        rowCount: args.rowCount,
        sizeBytes: args.sizeBytes,
        snapshotId: args.snapshotId,
        createdAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("resultCache", {
      ...args,
      createdAt: now,
    });
  },
});

export const setJobStatus = mutation({
  args: {
    jobId: v.string(),
    datasetId: v.optional(v.string()),
    kind: v.optional(
      v.union(v.literal("ingest"), v.literal("materialize"), v.literal("rebuild")),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error"),
    ),
    resultRef: v.optional(v.string()),
    error: v.optional(v.string()),
    progress: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("jobs")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        resultRef: args.resultRef,
        error: args.error,
        progress: args.progress,
        updatedAt: now,
      });
      return existing._id;
    }
    if (!args.datasetId || !args.kind) {
      throw new Error("datasetId and kind required when creating job");
    }
    return await ctx.db.insert("jobs", {
      jobId: args.jobId,
      datasetId: args.datasetId,
      kind: args.kind,
      status: args.status,
      resultRef: args.resultRef,
      error: args.error,
      progress: args.progress,
      updatedAt: now,
      createdAt: now,
    });
  },
});

export const toggleStar = mutation({
  args: { datasetId: v.string() },
  handler: async (ctx, args) => {
    const id = await identity(ctx);
    if (!id) throw new Error("Unauthorized");
    const existing = await ctx.db
      .query("stars")
      .withIndex("by_user_dataset", (q) =>
        q.eq("userId", id.subject).eq("datasetId", args.datasetId),
      )
      .unique();
    const ds = await ctx.db
      .query("datasets")
      .withIndex("by_datasetId", (q) => q.eq("datasetId", args.datasetId))
      .unique();
    if (!ds) throw new Error("Dataset not found");
    if (existing) {
      await ctx.db.delete(existing._id);
      await ctx.db.patch(ds._id, { stars: Math.max(0, ds.stars - 1) });
      return { starred: false, stars: Math.max(0, ds.stars - 1) };
    }
    await ctx.db.insert("stars", {
      userId: id.subject,
      datasetId: args.datasetId,
    });
    await ctx.db.patch(ds._id, { stars: ds.stars + 1 });
    return { starred: true, stars: ds.stars + 1 };
  },
});

export const recordQueryHistory = mutation({
  args: {
    datasetId: v.string(),
    queryHash: v.string(),
    costTier: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await identity(ctx);
    if (!id) return null;
    return await ctx.db.insert("queryHistory", {
      userId: id.subject,
      datasetId: args.datasetId,
      queryHash: args.queryHash,
      costTier: args.costTier,
      createdAt: Date.now(),
    });
  },
});

export const markDerivedStale = mutation({
  args: {
    datasetId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("datasets")
      .withIndex("by_datasetId", (q) => q.eq("datasetId", args.datasetId))
      .unique();
    if (!row) throw new Error("Dataset not found");
    await ctx.db.patch(row._id, {
      stale: true,
      staleReason: args.reason,
      updatedAt: Date.now(),
    });
  },
});

/** Service-key path: get dataset without user JWT (Worker). */
export const getDatasetService = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("datasets")
      .withIndex("by_datasetId", (q) => q.eq("datasetId", args.id))
      .unique();
    if (!row) return null;
    return {
      ...toMeta(row),
      schema: row.schema,
      derivedSpec: row.derivedSpec,
      materializationDecision: row.materializationDecision,
      stale: row.stale,
      staleReason: row.staleReason,
      icebergNamespace: row.icebergNamespace,
      icebergTable: row.icebergTable,
    };
  },
});

export const listDatasetsService = query({
  args: {
    tag: v.optional(v.string()),
    search: v.optional(v.string()),
    owner: v.optional(v.string()),
    includePrivateFor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    let rows = await ctx.db.query("datasets").take(500);
    rows = rows.filter((d) => {
      if (d.visibility === "public") return true;
      return args.includePrivateFor && d.owner === args.includePrivateFor;
    });
    if (args.owner) rows = rows.filter((d) => d.owner === args.owner);
    if (args.tag) {
      const tag = args.tag.toLowerCase();
      rows = rows.filter((d) => d.tags.some((t) => t.toLowerCase() === tag));
    }
    if (args.search) {
      const s = args.search.toLowerCase();
      rows = rows.filter(
        (d) =>
          d.name.toLowerCase().includes(s) ||
          d.description?.toLowerCase().includes(s) ||
          d.tags.some((t) => t.toLowerCase().includes(s)),
      );
    }
    return rows.slice(0, limit).map(toMeta);
  },
});

export const createDatasetEntryService = mutation({
  args: {
    datasetId: v.string(),
    owner: v.string(),
    visibility,
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.array(v.string()),
    kind: v.optional(kind),
    derivedSpec: v.optional(v.any()),
    materializationDecision: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("datasets", {
      datasetId: args.datasetId,
      owner: args.owner,
      visibility: args.visibility,
      name: args.name,
      description: args.description,
      tags: args.tags,
      stars: 0,
      latestSnapshotId: "",
      rowCount: 0,
      sizeBytes: 0,
      kind: args.kind ?? "base",
      derivedSpec: args.derivedSpec,
      materializationDecision: args.materializationDecision,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Seed fake public datasets for UI development (dev only). */
export const seedDemoDatasets = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const demos = [
      {
        datasetId: "demo_nyc_taxi",
        owner: "demo",
        name: "nyc-taxi-sample",
        description: "NYC yellow taxi trips sample — partitioned by pickup_date",
        tags: ["transport", "nyc", "taxi"],
        rowCount: 1000,
        sizeBytes: 120_000,
        columns: [
          { name: "pickup_date", type: "date", nullable: false, isPartition: true },
          { name: "fare_amount", type: "double", nullable: false, isPartition: false, min: 0, max: 250 },
          { name: "passenger_count", type: "long", nullable: true, isPartition: false },
          { name: "trip_distance", type: "double", nullable: false, isPartition: false },
        ],
      },
      {
        datasetId: "demo_sensors",
        owner: "demo",
        name: "iot-sensors",
        description: "Synthetic IoT time-series with device_id + ts partitions",
        tags: ["iot", "timeseries"],
        rowCount: 5000,
        sizeBytes: 800_000,
        columns: [
          { name: "device_id", type: "string", nullable: false, isPartition: true },
          { name: "ts", type: "timestamp", nullable: false, isPartition: true },
          { name: "temp_c", type: "double", nullable: false, isPartition: false },
          { name: "humidity", type: "double", nullable: true, isPartition: false },
        ],
      },
    ];

    for (const d of demos) {
      const existing = await ctx.db
        .query("datasets")
        .withIndex("by_datasetId", (q) => q.eq("datasetId", d.datasetId))
        .unique();
      if (existing) continue;
      const snapshotId = `${d.datasetId}_snap1`;
      await ctx.db.insert("datasets", {
        datasetId: d.datasetId,
        owner: d.owner,
        visibility: "public",
        name: d.name,
        description: d.description,
        tags: d.tags,
        stars: 3,
        latestSnapshotId: snapshotId,
        rowCount: d.rowCount,
        sizeBytes: d.sizeBytes,
        kind: "base",
        schema: {
          datasetId: d.datasetId,
          snapshotId,
          columns: d.columns.map((c) => ({
            ...c,
            nullRate: 0,
            distinctCount: 10,
          })),
          rowCount: d.rowCount,
          sizeBytes: d.sizeBytes,
          partitionColumns: d.columns.filter((c) => c.isPartition).map((c) => c.name),
          sampleRows: [],
        },
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

const visibility = v.union(v.literal("public"), v.literal("private"));
const kind = v.union(v.literal("base"), v.literal("derived"));

function toMeta(row: {
  datasetId: string;
  owner: string;
  visibility: "public" | "private";
  name: string;
  description?: string;
  tags: string[];
  stars: number;
  latestSnapshotId: string;
  rowCount: number;
  sizeBytes: number;
  kind: "base" | "derived";
  createdAt: number;
  updatedAt: number;
}) {
  return {
    id: row.datasetId,
    owner: row.owner,
    visibility: row.visibility,
    name: row.name,
    description: row.description,
    tags: row.tags,
    stars: row.stars,
    latestSnapshotId: row.latestSnapshotId,
    rowCount: row.rowCount,
    sizeBytes: row.sizeBytes,
    kind: row.kind,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
