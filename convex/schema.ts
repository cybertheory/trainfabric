import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const visibility = v.union(v.literal("public"), v.literal("private"));
const kind = v.union(v.literal("base"), v.literal("derived"));
const jobKind = v.union(
  v.literal("ingest"),
  v.literal("materialize"),
  v.literal("rebuild"),
);
const jobStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("done"),
  v.literal("error"),
);

const columnSchema = v.object({
  name: v.string(),
  type: v.string(),
  nullable: v.boolean(),
  nullRate: v.optional(v.number()),
  distinctCount: v.optional(v.number()),
  min: v.optional(v.union(v.string(), v.number(), v.null())),
  max: v.optional(v.union(v.string(), v.number(), v.null())),
  isPartition: v.boolean(),
  description: v.optional(v.string()),
});

const schemaContract = v.object({
  datasetId: v.string(),
  snapshotId: v.string(),
  columns: v.array(columnSchema),
  rowCount: v.number(),
  sizeBytes: v.number(),
  partitionColumns: v.array(v.string()),
  sampleRows: v.array(v.any()),
});

const derivedSource = v.object({
  datasetId: v.string(),
  snapshotPin: v.optional(v.string()),
  query: v.object({
    datasetId: v.string(),
    columns: v.optional(v.array(v.string())),
    filter: v.optional(v.string()),
    snapshot: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("stream"), v.literal("link"))),
    limit: v.optional(v.number()),
    branch: v.optional(v.string()),
  }),
});

const derivedSpec = v.object({
  sources: v.array(derivedSource),
  combine: v.union(
    v.object({ op: v.literal("single") }),
    v.object({ op: v.literal("union") }),
    v.object({
      op: v.literal("join"),
      on: v.array(v.string()),
      how: v.union(
        v.literal("inner"),
        v.literal("left"),
        v.literal("right"),
        v.literal("full"),
      ),
    }),
  ),
  materialization: v.union(
    v.literal("pointer"),
    v.literal("materialized"),
    v.literal("auto"),
  ),
  followLatest: v.boolean(),
});

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
  }).index("by_clerk", ["clerkId"]),

  datasets: defineTable({
    datasetId: v.string(),
    owner: v.string(),
    visibility,
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.array(v.string()),
    stars: v.number(),
    latestSnapshotId: v.string(),
    rowCount: v.number(),
    sizeBytes: v.number(),
    kind,
    schema: v.optional(schemaContract),
    derivedSpec: v.optional(derivedSpec),
    materializationDecision: v.optional(
      v.object({
        mode: v.union(v.literal("pointer"), v.literal("materialized")),
        reason: v.string(),
        hybrid: v.optional(v.boolean()),
      }),
    ),
    stale: v.optional(v.boolean()),
    staleReason: v.optional(v.string()),
    icebergNamespace: v.optional(v.string()),
    icebergTable: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_datasetId", ["datasetId"])
    .index("by_owner", ["owner"])
    .index("by_visibility", ["visibility"])
    .index("by_owner_name", ["owner", "name"]),

  resultCache: defineTable({
    queryHash: v.string(),
    datasetId: v.string(),
    snapshotId: v.string(),
    r2Url: v.string(),
    rowCount: v.number(),
    sizeBytes: v.number(),
    createdAt: v.number(),
  }).index("by_queryHash", ["queryHash"]),

  jobs: defineTable({
    jobId: v.string(),
    datasetId: v.string(),
    kind: jobKind,
    status: jobStatus,
    resultRef: v.optional(v.string()),
    error: v.optional(v.string()),
    progress: v.optional(v.number()),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_jobId", ["jobId"])
    .index("by_datasetId", ["datasetId"]),

  stars: defineTable({
    userId: v.string(),
    datasetId: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_dataset", ["datasetId"])
    .index("by_user_dataset", ["userId", "datasetId"]),

  queryHistory: defineTable({
    userId: v.string(),
    datasetId: v.string(),
    queryHash: v.string(),
    costTier: v.string(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  snapshots: defineTable({
    datasetId: v.string(),
    snapshotId: v.string(),
    parentSnapshotId: v.optional(v.string()),
    rowCount: v.number(),
    sizeBytes: v.number(),
    schema: v.optional(schemaContract),
    createdAt: v.number(),
    branch: v.optional(v.string()),
  })
    .index("by_dataset", ["datasetId"])
    .index("by_snapshot", ["snapshotId"]),
});
