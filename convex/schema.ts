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

  /** User↔dataset subscription (connect / subscribe). */
  connections: defineTable({
    userId: v.string(),
    datasetId: v.string(),
    source: v.union(
      v.literal("manual"),
      v.literal("query"),
      v.literal("sample"),
      v.literal("agent"),
    ),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_dataset", ["datasetId"])
    .index("by_user_dataset", ["userId", "datasetId"]),

  socialPosts: defineTable({
    postId: v.string(),
    authorId: v.string(),
    authorName: v.optional(v.string()),
    authorImage: v.optional(v.string()),
    authorUsername: v.optional(v.string()),
    authorIsAgent: v.optional(v.boolean()),
    datasetId: v.string(),
    body: v.string(),
    source: v.union(v.literal("user"), v.literal("agent")),
    findings: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_postId", ["postId"])
    .index("by_dataset", ["datasetId"])
    .index("by_author", ["authorId"])
    .index("by_created", ["createdAt"]),

  /** Social identity profiles keyed by auth subject (Clerk `sub` / agent). */
  profiles: defineTable({
    userId: v.string(),
    displayName: v.string(),
    username: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    email: v.optional(v.string()),
    bio: v.optional(v.string()),
    isAgent: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  notifications: defineTable({
    notificationId: v.string(),
    userId: v.string(),
    kind: v.union(
      v.literal("social_post"),
      v.literal("connection"),
      v.literal("job"),
      v.literal("info"),
    ),
    title: v.string(),
    body: v.string(),
    href: v.optional(v.string()),
    postId: v.optional(v.string()),
    datasetId: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_notificationId", ["notificationId"])
    .index("by_user", ["userId"])
    .index("by_user_unread", ["userId", "read"]),

  autoRuns: defineTable({
    autoRunId: v.string(),
    datasetId: v.optional(v.string()),
    boundDatasets: v.optional(v.array(v.string())),
    goal: v.optional(v.string()),
    ownerId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("provisioning"),
      v.literal("running"),
      v.literal("awaiting_user"),
      v.literal("paused"),
      v.literal("done"),
      v.literal("error"),
      v.literal("cancelled"),
    ),
    repo: v.any(),
    protocol: v.any(),
    box: v.any(),
    compute: v.any(),
    progress: v.any(),
    resultRef: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_autoRunId", ["autoRunId"])
    .index("by_datasetId", ["datasetId"])
    .index("by_ownerId", ["ownerId"]),

  autoActivity: defineTable({
    activityId: v.string(),
    autoRunId: v.string(),
    kind: v.union(
      v.literal("status"),
      v.literal("dataset_bound"),
      v.literal("trial"),
      v.literal("message"),
      v.literal("box"),
      v.literal("note"),
    ),
    message: v.string(),
    meta: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_activityId", ["activityId"])
    .index("by_autoRunId", ["autoRunId"]),

  autoMessages: defineTable({
    messageId: v.string(),
    autoRunId: v.string(),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
      v.literal("tool"),
    ),
    source: v.union(
      v.literal("dashboard"),
      v.literal("mcp"),
      v.literal("api"),
      v.literal("daemon"),
    ),
    content: v.string(),
    meta: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_autoRunId", ["autoRunId"]),

  autoTrials: defineTable({
    trialId: v.string(),
    autoRunId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error"),
      v.literal("cancelled"),
    ),
    hypothesis: v.optional(v.string()),
    commitSha: v.optional(v.string()),
    externalId: v.optional(v.string()),
    score: v.optional(v.number()),
    kept: v.optional(v.boolean()),
    artifactRef: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_trialId", ["trialId"])
    .index("by_autoRunId", ["autoRunId"])
    .index("by_status", ["status"]),

  autoRunners: defineTable({
    runnerId: v.string(),
    ownerId: v.string(),
    name: v.string(),
    tokenHash: v.string(),
    capacity: v.optional(v.string()),
    lastHeartbeatAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_runnerId", ["runnerId"])
    .index("by_ownerId", ["ownerId"])
    .index("by_tokenHash", ["tokenHash"]),

  githubAccounts: defineTable({
    userId: v.string(),
    githubUserId: v.number(),
    login: v.string(),
    avatarUrl: v.optional(v.string()),
    userAccessTokenEnc: v.string(),
    tokenExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  githubInstallations: defineTable({
    installationId: v.number(),
    userId: v.string(),
    accountLogin: v.string(),
    accountType: v.union(v.literal("User"), v.literal("Organization")),
    accountId: v.number(),
    avatarUrl: v.optional(v.string()),
    suspended: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_installationId", ["installationId"])
    .index("by_userId", ["userId"]),
});
