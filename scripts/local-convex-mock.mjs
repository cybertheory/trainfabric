/**
 * Tiny local stand-in for Convex HTTP actions (dev only).
 * Serves the Worker's CONVEX_URL when a real Convex deploy isn't configured.
 */
import { createServer } from "node:http";

const datasets = new Map([
  [
    "demo_nyc_taxi",
    {
      id: "demo_nyc_taxi",
      datasetId: "demo_nyc_taxi",
      owner: "demo",
      visibility: "public",
      name: "nyc-taxi-sample",
      description: "NYC yellow taxi trips sample — partitioned by pickup_date",
      tags: ["transport", "nyc", "taxi"],
      stars: 3,
      latestSnapshotId: "snap1",
      rowCount: 1000,
      sizeBytes: 120000,
      kind: "base",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      schema: {
        datasetId: "demo_nyc_taxi",
        snapshotId: "snap1",
        rowCount: 1000,
        sizeBytes: 120000,
        partitionColumns: ["pickup_date"],
        sampleRows: [
          { pickup_date: "2024-01-01", fare_amount: 12.5, passenger_count: 1, trip_distance: 2.3 },
          { pickup_date: "2024-01-02", fare_amount: 22.0, passenger_count: 3, trip_distance: 5.2 },
        ],
        columns: [
          { name: "pickup_date", type: "date", nullable: false, isPartition: true },
          { name: "fare_amount", type: "double", nullable: false, isPartition: false, min: 0, max: 250 },
          { name: "passenger_count", type: "long", nullable: true, isPartition: false },
          { name: "trip_distance", type: "double", nullable: false, isPartition: false },
        ],
      },
    },
  ],
  [
    "demo_sensors",
    {
      id: "demo_sensors",
      datasetId: "demo_sensors",
      owner: "demo",
      visibility: "public",
      name: "iot-sensors",
      description: "Synthetic IoT time-series with device_id + ts partitions",
      tags: ["iot", "timeseries"],
      stars: 3,
      latestSnapshotId: "snap1",
      rowCount: 5000,
      sizeBytes: 800000,
      kind: "base",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      schema: {
        datasetId: "demo_sensors",
        snapshotId: "snap1",
        rowCount: 5000,
        sizeBytes: 800000,
        partitionColumns: ["device_id"],
        sampleRows: [],
        columns: [
          { name: "device_id", type: "string", nullable: false, isPartition: true },
          { name: "ts", type: "timestamp", nullable: false, isPartition: true },
          { name: "temp_c", type: "double", nullable: false, isPartition: false },
          { name: "humidity", type: "double", nullable: true, isPartition: false },
        ],
      },
    },
  ],
]);

const cache = new Map();
const jobs = new Map();

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function checkKey(req) {
  return req.headers["x-service-key"] === "dev-service-key";
}

const server = createServer(async (req, res) => {
  if (!checkKey(req)) return json(res, 401, { error: "Unauthorized" });
  const url = new URL(req.url ?? "/", "http://localhost");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  const body = raw ? JSON.parse(raw) : {};

  if (url.pathname === "/api/datasets/list" && req.method === "POST") {
    let rows = [...datasets.values()];
    if (body.search) {
      const s = String(body.search).toLowerCase();
      rows = rows.filter(
        (d) =>
          d.name.includes(s) ||
          d.description?.toLowerCase().includes(s) ||
          d.tags.some((t) => t.includes(s)),
      );
    }
    if (body.tag) {
      const t = String(body.tag).toLowerCase();
      rows = rows.filter((d) => d.tags.some((x) => x.toLowerCase() === t));
    }
    return json(
      res,
      200,
      rows.map(({ schema, ...meta }) => meta),
    );
  }
  if (url.pathname === "/api/datasets/get" && req.method === "POST") {
    return json(res, 200, datasets.get(body.id) ?? null);
  }
  if (url.pathname === "/api/cache/lookup" && req.method === "POST") {
    return json(res, 200, cache.get(body.queryHash) ?? null);
  }
  if (url.pathname === "/api/cache/upsert" && req.method === "POST") {
    cache.set(body.queryHash, { ...body, createdAt: Date.now() });
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/api/datasets/create" && req.method === "POST") {
    const id = body.datasetId;
    datasets.set(id, {
      id,
      datasetId: id,
      owner: body.owner,
      visibility: body.visibility,
      name: body.name,
      description: body.description,
      tags: body.tags ?? [],
      stars: 0,
      latestSnapshotId: "",
      rowCount: 0,
      sizeBytes: 0,
      kind: body.kind ?? "base",
      derivedSpec: body.derivedSpec,
      materializationDecision: body.materializationDecision,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/api/datasets/update-ingest" && req.method === "POST") {
    const d = datasets.get(body.datasetId);
    if (d) {
      Object.assign(d, {
        latestSnapshotId: body.snapshotId,
        rowCount: body.rowCount,
        sizeBytes: body.sizeBytes,
        schema: body.schema,
        icebergNamespace: body.icebergNamespace,
        icebergTable: body.icebergTable,
        updatedAt: Date.now(),
      });
    }
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/api/jobs/set" && req.method === "POST") {
    const existing = jobs.get(body.jobId) ?? {};
    jobs.set(body.jobId, { ...existing, ...body, updatedAt: Date.now() });
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/api/jobs/get" && req.method === "POST") {
    return json(res, 200, jobs.get(body.id) ?? null);
  }
  json(res, 404, { error: "not found" });
});

const port = Number(process.env.PORT ?? 3211);
server.listen(port, "127.0.0.1", () => {
  console.log(`local-convex mock on http://127.0.0.1:${port}`);
});
