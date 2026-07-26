/** HTTP actions for the Worker to call Convex without a user JWT (service key). */
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const http = httpRouter();

function checkServiceKey(req: Request): boolean {
  const key = req.headers.get("x-service-key");
  return !!key && key === process.env.CONVEX_SERVICE_KEY;
}

http.route({
  path: "/api/cache/lookup",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { queryHash } = await req.json();
    const entry = await ctx.runQuery(api.datasets.lookupCache, { queryHash });
    return Response.json(entry);
  }),
});

http.route({
  path: "/api/cache/upsert",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    await ctx.runMutation(api.datasets.upsertCacheEntry, body);
    return Response.json({ ok: true });
  }),
});

http.route({
  path: "/api/datasets/get",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { id } = await req.json();
    // Service path: bypass user auth by reading DB via internal-style query
    const entry = await ctx.runQuery(api.datasets.getDatasetService, { id });
    return Response.json(entry);
  }),
});

http.route({
  path: "/api/datasets/list",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const rows = await ctx.runQuery(api.datasets.listDatasetsService, body);
    return Response.json(rows);
  }),
});

http.route({
  path: "/api/datasets/create",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    await ctx.runMutation(api.datasets.createDatasetEntryService, body);
    return Response.json({ ok: true });
  }),
});

http.route({
  path: "/api/datasets/update-ingest",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    await ctx.runMutation(api.datasets.updateDatasetAfterIngest, body);
    return Response.json({ ok: true });
  }),
});

http.route({
  path: "/api/jobs/set",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    await ctx.runMutation(api.datasets.setJobStatus, body);
    return Response.json({ ok: true });
  }),
});

http.route({
  path: "/api/jobs/get",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { id } = await req.json();
    const job = await ctx.runQuery(api.datasets.getJob, { id });
    return Response.json(job);
  }),
});

http.route({
  path: "/api/seed",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    await ctx.runMutation(internal.datasets.seedDemoDatasets, {});
    return Response.json({ ok: true });
  }),
});

// ---- Social / connections / notifications ----

http.route({
  path: "/api/social/ensure-connection",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runMutation(api.social.ensureConnectionService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/toggle-connection",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runMutation(api.social.toggleConnectionService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/get-connection",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runQuery(api.social.getConnectionService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/list-connections",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runQuery(api.social.listConnectionsService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/create-post",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runMutation(api.social.createSocialPostService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/get-post",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runQuery(api.social.getSocialPostService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/list-feed",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runQuery(api.social.listFeedService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/list-notifications",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runQuery(api.social.listNotificationsService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/mark-read",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runMutation(api.social.markNotificationReadService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/mark-all-read",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runMutation(api.social.markAllNotificationsReadService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/upsert-profile",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runMutation(api.social.upsertProfileService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/get-profile",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runQuery(api.social.getProfileService, body);
    return Response.json(out);
  }),
});

http.route({
  path: "/api/social/get-profiles",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const out = await ctx.runQuery(api.social.getProfilesService, body);
    return Response.json(out);
  }),
});

// ---- Autoresearch /auto ----

http.route({
  path: "/api/auto/runs/upsert",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    await ctx.runMutation(api.autoRuns.upsertAutoRun, body);
    return Response.json({ ok: true });
  }),
});

http.route({
  path: "/api/auto/runs/get",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { id } = await req.json();
    const row = await ctx.runQuery(api.autoRuns.getAutoRun, { id });
    return Response.json(row);
  }),
});

http.route({
  path: "/api/auto/runs/list",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { datasetId } = await req.json();
    const rows = await ctx.runQuery(api.autoRuns.listAutoRunsByDataset, { datasetId });
    return Response.json(rows);
  }),
});

http.route({
  path: "/api/auto/runs/list-by-owner",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { ownerId } = await req.json();
    const rows = await ctx.runQuery(api.autoRuns.listAutoRunsByOwner, { ownerId });
    return Response.json(rows);
  }),
});

http.route({
  path: "/api/auto/trials/upsert",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    await ctx.runMutation(api.autoRuns.upsertAutoTrial, body);
    return Response.json({ ok: true });
  }),
});

http.route({
  path: "/api/auto/trials/get",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { id } = await req.json();
    const row = await ctx.runQuery(api.autoRuns.getAutoTrial, { id });
    return Response.json(row);
  }),
});

http.route({
  path: "/api/auto/trials/list",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { autoRunId } = await req.json();
    const rows = await ctx.runQuery(api.autoRuns.listAutoTrials, { autoRunId });
    return Response.json(rows);
  }),
});

http.route({
  path: "/api/auto/trials/claim",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { runnerId } = await req.json();
    const row = await ctx.runMutation(api.autoRuns.claimPendingTrial, { runnerId });
    return Response.json(row);
  }),
});

http.route({
  path: "/api/auto/runners/upsert",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    const row = await ctx.runMutation(api.autoRuns.upsertAutoRunner, body);
    return Response.json(row);
  }),
});

http.route({
  path: "/api/auto/runners/by-token",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { tokenHash } = await req.json();
    const row = await ctx.runQuery(api.autoRuns.getAutoRunnerByTokenHash, { tokenHash });
    return Response.json(row);
  }),
});

http.route({
  path: "/api/auto/runners/list",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { ownerId } = await req.json();
    const rows = await ctx.runQuery(api.autoRuns.listAutoRunnersByOwner, { ownerId });
    return Response.json(rows);
  }),
});

http.route({
  path: "/api/auto/activity/list",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { autoRunId } = await req.json();
    const rows = await ctx.runQuery(api.autoRuns.listActivity, { autoRunId });
    return Response.json(rows);
  }),
});

http.route({
  path: "/api/auto/activity/append",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    await ctx.runMutation(api.autoRuns.appendActivity, body);
    return Response.json({ ok: true });
  }),
});

http.route({
  path: "/api/auto/messages/list",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const { autoRunId } = await req.json();
    const rows = await ctx.runQuery(api.autoRuns.listMessages, { autoRunId });
    return Response.json(rows);
  }),
});

http.route({
  path: "/api/auto/messages/append",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!checkServiceKey(req)) return new Response("Unauthorized", { status: 401 });
    const body = await req.json();
    await ctx.runMutation(api.autoRuns.appendMessage, body);
    return Response.json({ ok: true });
  }),
});

export default http;
