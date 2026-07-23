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

export default http;
