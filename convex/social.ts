import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const connectionSource = v.union(
  v.literal("manual"),
  v.literal("query"),
  v.literal("sample"),
  v.literal("agent"),
);

const postSource = v.union(v.literal("user"), v.literal("agent"));

const notificationKind = v.union(
  v.literal("social_post"),
  v.literal("connection"),
  v.literal("job"),
  v.literal("info"),
);

/** Service-key path: ensure connection exists (idempotent). */
export const ensureConnectionService = mutation({
  args: {
    userId: v.string(),
    datasetId: v.string(),
    source: connectionSource,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_user_dataset", (q) =>
        q.eq("userId", args.userId).eq("datasetId", args.datasetId),
      )
      .unique();
    if (existing) {
      return { connected: true, created: false, source: existing.source };
    }
    await ctx.db.insert("connections", {
      userId: args.userId,
      datasetId: args.datasetId,
      source: args.source,
      createdAt: Date.now(),
    });
    return { connected: true, created: true, source: args.source };
  },
});

export const toggleConnectionService = mutation({
  args: {
    userId: v.string(),
    datasetId: v.string(),
    source: v.optional(connectionSource),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_user_dataset", (q) =>
        q.eq("userId", args.userId).eq("datasetId", args.datasetId),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { connected: false };
    }
    await ctx.db.insert("connections", {
      userId: args.userId,
      datasetId: args.datasetId,
      source: args.source ?? "manual",
      createdAt: Date.now(),
    });
    return { connected: true };
  },
});

export const getConnectionService = query({
  args: { userId: v.string(), datasetId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("connections")
      .withIndex("by_user_dataset", (q) =>
        q.eq("userId", args.userId).eq("datasetId", args.datasetId),
      )
      .unique();
    return row
      ? {
          userId: row.userId,
          datasetId: row.datasetId,
          source: row.source,
          createdAt: row.createdAt,
        }
      : null;
  },
});

export const listConnectionsService = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return rows.map((r) => ({
      userId: r.userId,
      datasetId: r.datasetId,
      source: r.source,
      createdAt: r.createdAt,
    }));
  },
});

export const listConnectionsByDatasetService = query({
  args: { datasetId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
    return rows.map((r) => ({
      userId: r.userId,
      datasetId: r.datasetId,
      source: r.source,
      createdAt: r.createdAt,
    }));
  },
});

export const createSocialPostService = mutation({
  args: {
    postId: v.string(),
    authorId: v.string(),
    authorName: v.optional(v.string()),
    datasetId: v.string(),
    body: v.string(),
    source: postSource,
    findings: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();

    // Resolve author identity from profile; explicit authorName wins (agents).
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.authorId))
      .unique();
    const authorName =
      args.authorName ??
      profile?.displayName ??
      (args.source === "agent" ? "agent" : undefined);
    const authorImage = profile?.imageUrl;
    const authorUsername = profile?.username;
    const authorIsAgent = profile?.isAgent ?? args.source === "agent";

    await ctx.db.insert("socialPosts", {
      postId: args.postId,
      authorId: args.authorId,
      authorName,
      authorImage,
      authorUsername,
      authorIsAgent,
      datasetId: args.datasetId,
      body: args.body,
      source: args.source,
      findings: args.findings,
      createdAt,
    });

    // Fan-out notifications to connected users (except author).
    const connected = await ctx.db
      .query("connections")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
    const ds = await ctx.db
      .query("datasets")
      .withIndex("by_datasetId", (q) => q.eq("datasetId", args.datasetId))
      .unique();
    const label = ds ? `${ds.owner}/${ds.name}` : args.datasetId;
    const who = authorName || (args.source === "agent" ? "an agent" : "someone");
    for (const c of connected) {
      if (c.userId === args.authorId) continue;
      await ctx.db.insert("notifications", {
        notificationId: `nt_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
        userId: c.userId,
        kind: "social_post",
        title: `Update on ${label}`,
        body: `${who}: ${args.body.slice(0, 140)}`,
        href: `/posts/${args.postId}`,
        postId: args.postId,
        datasetId: args.datasetId,
        read: false,
        createdAt,
      });
    }

    return {
      id: args.postId,
      authorId: args.authorId,
      authorName,
      authorImage,
      authorUsername,
      authorIsAgent,
      datasetId: args.datasetId,
      datasetOwner: ds?.owner,
      datasetName: ds?.name,
      body: args.body,
      source: args.source,
      findings: args.findings,
      createdAt,
    };
  },
});

// ---- Profiles ----

export const upsertProfileService = mutation({
  args: {
    userId: v.string(),
    displayName: v.optional(v.string()),
    username: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    email: v.optional(v.string()),
    bio: v.optional(v.string()),
    isAgent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const merged = {
      userId: args.userId,
      displayName:
        args.displayName ?? existing?.displayName ?? args.email ?? existing?.email ?? args.userId,
      username: args.username ?? existing?.username,
      imageUrl: args.imageUrl ?? existing?.imageUrl,
      email: args.email ?? existing?.email,
      bio: args.bio ?? existing?.bio,
      isAgent: args.isAgent ?? existing?.isAgent ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, merged);
    } else {
      await ctx.db.insert("profiles", merged);
    }
    return merged;
  },
});

export const getProfileService = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!row) return null;
    return {
      userId: row.userId,
      displayName: row.displayName,
      username: row.username,
      imageUrl: row.imageUrl,
      email: row.email,
      bio: row.bio,
      isAgent: row.isAgent,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});

export const getProfilesService = query({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const uniq = [...new Set(args.userIds)].filter(Boolean);
    const out = [];
    for (const userId of uniq) {
      const row = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique();
      if (row) {
        out.push({
          userId: row.userId,
          displayName: row.displayName,
          username: row.username,
          imageUrl: row.imageUrl,
          email: row.email,
          bio: row.bio,
          isAgent: row.isAgent,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }
    }
    return { profiles: out };
  },
});

export const getSocialPostService = query({
  args: { postId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("socialPosts")
      .withIndex("by_postId", (q) => q.eq("postId", args.postId))
      .unique();
    if (!row) return null;
    const ds = await ctx.db
      .query("datasets")
      .withIndex("by_datasetId", (q) => q.eq("datasetId", row.datasetId))
      .unique();
    return {
      id: row.postId,
      authorId: row.authorId,
      authorName: row.authorName,
      authorImage: row.authorImage,
      authorUsername: row.authorUsername,
      authorIsAgent: row.authorIsAgent,
      datasetId: row.datasetId,
      datasetOwner: ds?.owner,
      datasetName: ds?.name,
      body: row.body,
      source: row.source,
      findings: row.findings,
      createdAt: row.createdAt,
    };
  },
});

export const listFeedService = query({
  args: {
    userId: v.optional(v.string()),
    datasetId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 40;
    let datasetIds: string[] | null = null;
    if (args.datasetId) {
      datasetIds = [args.datasetId];
    } else if (args.userId) {
      const conns = await ctx.db
        .query("connections")
        .withIndex("by_user", (q) => q.eq("userId", args.userId!))
        .collect();
      datasetIds = conns.map((c) => c.datasetId);
    }

    // Broad scan then filter — fine for MVP volumes.
    const all = await ctx.db.query("socialPosts").order("desc").take(200);
    const filtered = datasetIds
      ? all.filter((p) => datasetIds!.includes(p.datasetId))
      : all;

    const out = [];
    for (const row of filtered.slice(0, limit)) {
      const ds = await ctx.db
        .query("datasets")
        .withIndex("by_datasetId", (q) => q.eq("datasetId", row.datasetId))
        .unique();
      out.push({
        id: row.postId,
        authorId: row.authorId,
        authorName: row.authorName,
        authorImage: row.authorImage,
        authorUsername: row.authorUsername,
        authorIsAgent: row.authorIsAgent,
        datasetId: row.datasetId,
        datasetOwner: ds?.owner,
        datasetName: ds?.name,
        body: row.body,
        source: row.source,
        findings: row.findings,
        createdAt: row.createdAt,
      });
    }
    return out;
  },
});

export const listNotificationsService = query({
  args: { userId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit ?? 50);
    return rows.map((r) => ({
      id: r.notificationId,
      userId: r.userId,
      kind: r.kind,
      title: r.title,
      body: r.body,
      href: r.href,
      postId: r.postId,
      datasetId: r.datasetId,
      read: r.read,
      createdAt: r.createdAt,
    }));
  },
});

export const markNotificationReadService = mutation({
  args: { userId: v.string(), notificationId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("notifications")
      .withIndex("by_notificationId", (q) => q.eq("notificationId", args.notificationId))
      .unique();
    if (!row || row.userId !== args.userId) return { ok: false };
    await ctx.db.patch(row._id, { read: true });
    return { ok: true };
  },
});

export const markAllNotificationsReadService = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) => q.eq("userId", args.userId).eq("read", false))
      .collect();
    for (const r of rows) await ctx.db.patch(r._id, { read: true });
    return { ok: true, count: rows.length };
  },
});

export const createNotificationService = mutation({
  args: {
    notificationId: v.string(),
    userId: v.string(),
    kind: notificationKind,
    title: v.string(),
    body: v.string(),
    href: v.optional(v.string()),
    postId: v.optional(v.string()),
    datasetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    await ctx.db.insert("notifications", {
      ...args,
      read: false,
      createdAt,
    });
    return { id: args.notificationId, createdAt };
  },
});
