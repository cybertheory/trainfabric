import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const upsertAccount = mutation({
  args: {
    userId: v.string(),
    githubUserId: v.number(),
    login: v.string(),
    avatarUrl: v.optional(v.string()),
    userAccessTokenEnc: v.string(),
    tokenExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        githubUserId: args.githubUserId,
        login: args.login,
        avatarUrl: args.avatarUrl,
        userAccessTokenEnc: args.userAccessTokenEnc,
        tokenExpiresAt: args.tokenExpiresAt,
        updatedAt: args.updatedAt,
      });
    } else {
      await ctx.db.insert("githubAccounts", args);
    }
  },
});

export const getAccount = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("githubAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const deleteAccount = mutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db
      .query("githubAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const upsertInstallation = mutation({
  args: {
    installationId: v.number(),
    userId: v.string(),
    accountLogin: v.string(),
    accountType: v.union(v.literal("User"), v.literal("Organization")),
    accountId: v.number(),
    avatarUrl: v.optional(v.string()),
    suspended: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installationId", (q) => q.eq("installationId", args.installationId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        userId: args.userId,
        accountLogin: args.accountLogin,
        accountType: args.accountType,
        accountId: args.accountId,
        avatarUrl: args.avatarUrl,
        suspended: args.suspended,
        updatedAt: args.updatedAt,
      });
    } else {
      await ctx.db.insert("githubInstallations", args);
    }
  },
});

export const listInstallations = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("githubInstallations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const getInstallation = query({
  args: { installationId: v.number() },
  handler: async (ctx, { installationId }) => {
    return await ctx.db
      .query("githubInstallations")
      .withIndex("by_installationId", (q) => q.eq("installationId", installationId))
      .unique();
  },
});

export const deleteInstallation = mutation({
  args: { installationId: v.number() },
  handler: async (ctx, { installationId }) => {
    const existing = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installationId", (q) => q.eq("installationId", installationId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const deleteInstallationsForUser = mutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("githubInstallations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});

export const setInstallationSuspended = mutation({
  args: { installationId: v.number(), suspended: v.boolean() },
  handler: async (ctx, { installationId, suspended }) => {
    const existing = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installationId", (q) => q.eq("installationId", installationId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { suspended, updatedAt: Date.now() });
    }
  },
});
