import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const autoRunStatus = v.union(
  v.literal("pending"),
  v.literal("provisioning"),
  v.literal("running"),
  v.literal("paused"),
  v.literal("done"),
  v.literal("error"),
  v.literal("cancelled"),
);

const trialStatus = v.union(
  v.literal("pending"),
  v.literal("claimed"),
  v.literal("running"),
  v.literal("done"),
  v.literal("error"),
  v.literal("cancelled"),
);

function mapRun(row: {
  autoRunId: string;
  datasetId: string;
  ownerId: string;
  status: string;
  repo: unknown;
  protocol: unknown;
  box: unknown;
  compute: unknown;
  progress: unknown;
  resultRef?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}) {
  return {
    id: row.autoRunId,
    datasetId: row.datasetId,
    ownerId: row.ownerId,
    status: row.status,
    repo: row.repo,
    protocol: row.protocol,
    box: row.box,
    compute: row.compute,
    progress: row.progress,
    resultRef: row.resultRef,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTrial(row: {
  trialId: string;
  autoRunId: string;
  status: string;
  hypothesis?: string;
  commitSha?: string;
  externalId?: string;
  score?: number;
  kept?: boolean;
  artifactRef?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}) {
  return {
    id: row.trialId,
    autoRunId: row.autoRunId,
    status: row.status,
    hypothesis: row.hypothesis,
    commitSha: row.commitSha,
    externalId: row.externalId,
    score: row.score,
    kept: row.kept,
    artifactRef: row.artifactRef,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const getAutoRun = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const row = await ctx.db
      .query("autoRuns")
      .withIndex("by_autoRunId", (q) => q.eq("autoRunId", id))
      .unique();
    return row ? mapRun(row) : null;
  },
});

export const listAutoRunsByDataset = query({
  args: { datasetId: v.string() },
  handler: async (ctx, { datasetId }) => {
    const rows = await ctx.db
      .query("autoRuns")
      .withIndex("by_datasetId", (q) => q.eq("datasetId", datasetId))
      .collect();
    return rows.map(mapRun).sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listAutoRunsByOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    const rows = await ctx.db
      .query("autoRuns")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .collect();
    return rows.map(mapRun).sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const upsertAutoRun = mutation({
  args: {
    autoRunId: v.string(),
    datasetId: v.optional(v.string()),
    ownerId: v.optional(v.string()),
    status: autoRunStatus,
    repo: v.optional(v.any()),
    protocol: v.optional(v.any()),
    box: v.optional(v.any()),
    compute: v.optional(v.any()),
    progress: v.optional(v.any()),
    resultRef: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("autoRuns")
      .withIndex("by_autoRunId", (q) => q.eq("autoRunId", args.autoRunId))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        ...(args.repo !== undefined ? { repo: args.repo } : {}),
        ...(args.protocol !== undefined ? { protocol: args.protocol } : {}),
        ...(args.box !== undefined ? { box: args.box } : {}),
        ...(args.compute !== undefined ? { compute: args.compute } : {}),
        ...(args.progress !== undefined ? { progress: args.progress } : {}),
        ...(args.resultRef !== undefined ? { resultRef: args.resultRef } : {}),
        ...(args.error !== undefined ? { error: args.error } : {}),
        updatedAt: now,
      });
      return;
    }
    if (!args.datasetId || !args.ownerId || !args.repo || !args.protocol || !args.compute) {
      throw new Error("create AutoRun requires datasetId, ownerId, repo, protocol, compute");
    }
    await ctx.db.insert("autoRuns", {
      autoRunId: args.autoRunId,
      datasetId: args.datasetId,
      ownerId: args.ownerId,
      status: args.status,
      repo: args.repo,
      protocol: args.protocol,
      box: args.box ?? {},
      compute: args.compute,
      progress: args.progress ?? { trial: 0, updatedAt: now },
      resultRef: args.resultRef,
      error: args.error,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getAutoTrial = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const row = await ctx.db
      .query("autoTrials")
      .withIndex("by_trialId", (q) => q.eq("trialId", id))
      .unique();
    return row ? mapTrial(row) : null;
  },
});

export const listAutoTrials = query({
  args: { autoRunId: v.string() },
  handler: async (ctx, { autoRunId }) => {
    const rows = await ctx.db
      .query("autoTrials")
      .withIndex("by_autoRunId", (q) => q.eq("autoRunId", autoRunId))
      .collect();
    return rows.map(mapTrial).sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const upsertAutoTrial = mutation({
  args: {
    trialId: v.string(),
    autoRunId: v.optional(v.string()),
    status: trialStatus,
    hypothesis: v.optional(v.string()),
    commitSha: v.optional(v.string()),
    externalId: v.optional(v.string()),
    score: v.optional(v.number()),
    kept: v.optional(v.boolean()),
    artifactRef: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("autoTrials")
      .withIndex("by_trialId", (q) => q.eq("trialId", args.trialId))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        ...(args.hypothesis !== undefined ? { hypothesis: args.hypothesis } : {}),
        ...(args.commitSha !== undefined ? { commitSha: args.commitSha } : {}),
        ...(args.externalId !== undefined ? { externalId: args.externalId } : {}),
        ...(args.score !== undefined ? { score: args.score } : {}),
        ...(args.kept !== undefined ? { kept: args.kept } : {}),
        ...(args.artifactRef !== undefined ? { artifactRef: args.artifactRef } : {}),
        ...(args.error !== undefined ? { error: args.error } : {}),
        updatedAt: now,
      });
      return;
    }
    if (!args.autoRunId) throw new Error("create AutoTrial requires autoRunId");
    await ctx.db.insert("autoTrials", {
      trialId: args.trialId,
      autoRunId: args.autoRunId,
      status: args.status,
      hypothesis: args.hypothesis,
      commitSha: args.commitSha,
      externalId: args.externalId,
      score: args.score,
      kept: args.kept,
      artifactRef: args.artifactRef,
      error: args.error,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const claimPendingTrial = mutation({
  args: { runnerId: v.string() },
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("autoTrials")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .first();
    if (!pending) return null;
    const now = Date.now();
    await ctx.db.patch(pending._id, { status: "claimed", updatedAt: now });
    return mapTrial({ ...pending, status: "claimed", updatedAt: now });
  },
});

export const upsertAutoRunner = mutation({
  args: {
    runnerId: v.string(),
    ownerId: v.optional(v.string()),
    name: v.optional(v.string()),
    tokenHash: v.optional(v.string()),
    capacity: v.optional(v.string()),
    lastHeartbeatAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("autoRunners")
      .withIndex("by_runnerId", (q) => q.eq("runnerId", args.runnerId))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(args.capacity !== undefined ? { capacity: args.capacity } : {}),
        ...(args.lastHeartbeatAt !== undefined
          ? { lastHeartbeatAt: args.lastHeartbeatAt }
          : { lastHeartbeatAt: now }),
        ...(args.name !== undefined ? { name: args.name } : {}),
      });
      return {
        id: existing.runnerId,
        ownerId: existing.ownerId,
        name: args.name ?? existing.name,
        tokenHash: existing.tokenHash,
        capacity: args.capacity ?? existing.capacity,
        lastHeartbeatAt: args.lastHeartbeatAt ?? now,
        createdAt: existing.createdAt,
      };
    }
    if (!args.ownerId || !args.name || !args.tokenHash) {
      throw new Error("create AutoRunner requires ownerId, name, tokenHash");
    }
    await ctx.db.insert("autoRunners", {
      runnerId: args.runnerId,
      ownerId: args.ownerId,
      name: args.name,
      tokenHash: args.tokenHash,
      capacity: args.capacity,
      lastHeartbeatAt: now,
      createdAt: now,
    });
    return {
      id: args.runnerId,
      ownerId: args.ownerId,
      name: args.name,
      tokenHash: args.tokenHash,
      capacity: args.capacity,
      lastHeartbeatAt: now,
      createdAt: now,
    };
  },
});

export const getAutoRunnerByTokenHash = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const row = await ctx.db
      .query("autoRunners")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!row) return null;
    return {
      id: row.runnerId,
      ownerId: row.ownerId,
      name: row.name,
      tokenHash: row.tokenHash,
      capacity: row.capacity,
      lastHeartbeatAt: row.lastHeartbeatAt,
      createdAt: row.createdAt,
    };
  },
});

export const listAutoRunnersByOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    const rows = await ctx.db
      .query("autoRunners")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .collect();
    return rows.map((row) => ({
      id: row.runnerId,
      ownerId: row.ownerId,
      name: row.name,
      tokenHash: row.tokenHash,
      capacity: row.capacity,
      lastHeartbeatAt: row.lastHeartbeatAt,
      createdAt: row.createdAt,
    }));
  },
});
