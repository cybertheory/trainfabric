import { describe, expect, it, vi } from "vitest";
import {
  resolveQuery,
  AuthError,
  authorizeDataset,
  type ResolverDeps,
  type DatasetRecord,
  type ScanPlan,
  type CacheEntry,
} from "../src/resolver";
import { detectCycle, decideMaterialization, visibilityAllowed, expandPointer } from "../src/derived";
import type { QueryRequest } from "@trainfabric/shared";

function publicDataset(over: Partial<DatasetRecord> = {}): DatasetRecord {
  return {
    id: "ds1",
    owner: "user_a",
    visibility: "public",
    name: "taxi",
    tags: ["nyc"],
    connections: 0,
    latestSnapshotId: "snap1",
    rowCount: 100,
    sizeBytes: 1000,
    kind: "base",
    createdAt: 0,
    updatedAt: 0,
    icebergNamespace: "default",
    ...over,
  };
}

function makeDeps(over: Partial<ResolverDeps> & { plan?: ScanPlan; cache?: CacheEntry | null } = {}) {
  const scanPlan = vi.fn(
    async () =>
      over.plan ?? {
        case: "A" as const,
        matchedFiles: ["s3://bucket/f.parquet"],
        estimatedRows: 10,
        estimatedBytes: 100,
        reason: "aligned",
        partitionColumns: ["pickup_date"],
        manifest: {
          entries: [{ file: "s3://bucket/f.parquet", ranges: [[0, 99] as [number, number]], columns: [] }],
          estimatedRows: 10,
          estimatedBytes: 100,
        },
      },
  );
  const query = vi.fn(async () => ({
    mode: "link" as const,
    r2Path: "s3://bucket/results/h.parquet",
    rowCount: 5,
    sizeBytes: 50,
  }));
  const lookupCache = vi.fn(async () => over.cache ?? null);
  const upsertCache = vi.fn(async () => {});
  const deps: ResolverDeps = {
    getDataset: async () => (over.getDataset ? over.getDataset("ds1") : publicDataset()),
    lookupCache,
    upsertCache,
    scanPlan,
    query,
    presign: async (u) => `https://presigned/${u}`,
    ...over,
  };
  return { deps, scanPlan, query, lookupCache, upsertCache };
}

describe("resolveQuery cost paths", () => {
  it("cache hit → costTier cache, no scan/query", async () => {
    const cache: CacheEntry = {
      queryHash: "x",
      datasetId: "ds1",
      snapshotId: "snap1",
      r2Url: "s3://bucket/results/x.parquet",
      rowCount: 3,
      sizeBytes: 30,
    };
    const { deps, scanPlan, query } = makeDeps({ cache });
    const result = await resolveQuery({ datasetId: "ds1" }, null, deps);
    expect(result).toMatchObject({ costTier: "cache", mode: "link" });
    expect(scanPlan).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("cache hit estimateOnly", async () => {
    const cache: CacheEntry = {
      queryHash: "x",
      datasetId: "ds1",
      snapshotId: "snap1",
      r2Url: "s3://bucket/results/x.parquet",
      rowCount: 3,
      sizeBytes: 30,
    };
    const { deps, query } = makeDeps({ cache });
    const est = await resolveQuery({ datasetId: "ds1" }, null, deps, { estimateOnly: true });
    expect(est).toMatchObject({ costTier: "cache", cacheHit: true });
    expect(query).not.toHaveBeenCalled();
  });

  it("Case A → no query call + recordHistory", async () => {
    const recordHistory = vi.fn(async () => {});
    const { deps, query } = makeDeps({
      recordHistory,
      plan: {
        case: "A",
        matchedFiles: ["s3://b/f.parquet"],
        estimatedRows: 10,
        estimatedBytes: 100,
        reason: "partition",
        partitionColumns: ["pickup_date"],
        manifest: {
          entries: [{ file: "s3://b/f.parquet", ranges: [[0, 10]], columns: ["a"] }],
          estimatedRows: 10,
          estimatedBytes: 100,
        },
      },
    });
    const result = await resolveQuery(
      { datasetId: "ds1", filter: "pickup_date = '2024-01-01'" },
      { subject: "user_a" },
      deps,
    );
    expect(result).toMatchObject({ costTier: "A" });
    expect(query).not.toHaveBeenCalled();
    expect(recordHistory).toHaveBeenCalled();
  });

  it("Case A without matched files still returns", async () => {
    const { deps } = makeDeps({
      plan: {
        case: "A",
        matchedFiles: [],
        estimatedRows: 0,
        estimatedBytes: 0,
        reason: "empty",
        partitionColumns: [],
      },
    });
    const result = await resolveQuery({ datasetId: "ds1" }, null, deps);
    expect(result).toMatchObject({ costTier: "A" });
  });

  it("Case B stream result without r2Path skips cache write", async () => {
    const { deps, upsertCache } = makeDeps({
      plan: {
        case: "B",
        matchedFiles: [],
        estimatedRows: 0,
        estimatedBytes: 0,
        reason: "Filter on non-partition column(s)",
        partitionColumns: ["pickup_date"],
      },
      query: async () => ({
        mode: "stream",
        arrowBase64: "AQID",
        rowCount: 2,
        sizeBytes: 10,
      }),
    });
    const result = await resolveQuery(
      { datasetId: "ds1", filter: "fare_amount > 20" },
      null,
      deps,
    );
    expect(result).toMatchObject({ costTier: "B", mode: "stream" });
    expect(upsertCache).not.toHaveBeenCalled();
  });

  it("Case B → materialize + cache; re-query hits cache", async () => {
    const store = new Map<string, CacheEntry>();
    const { deps, query } = makeDeps({
      plan: {
        case: "B",
        matchedFiles: [],
        estimatedRows: 0,
        estimatedBytes: 0,
        reason: "Filter on non-partition column(s)",
        partitionColumns: ["pickup_date"],
      },
      lookupCache: async (h) => store.get(h) ?? null,
      upsertCache: async (e) => {
        store.set(e.queryHash, e);
      },
    });
    const req: QueryRequest = { datasetId: "ds1", filter: "fare_amount > 20" };
    const first = await resolveQuery(req, null, deps);
    expect(first).toMatchObject({ costTier: "B" });
    expect(query).toHaveBeenCalledTimes(1);
    const second = await resolveQuery(req, null, deps);
    expect(second).toMatchObject({ costTier: "cache" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("estimateOnly does not call query", async () => {
    const { deps, query } = makeDeps({
      plan: {
        case: "B",
        matchedFiles: [],
        estimatedRows: 1,
        estimatedBytes: 1,
        reason: "B",
        partitionColumns: [],
      },
    });
    const est = await resolveQuery({ datasetId: "ds1" }, null, deps, { estimateOnly: true });
    expect(est).toMatchObject({ costTier: "B", cacheHit: false });
    expect(query).not.toHaveBeenCalled();
  });

  it("private dataset without identity → 403", async () => {
    const { deps } = makeDeps({
      getDataset: async () => publicDataset({ visibility: "private", owner: "other" }),
    });
    await expect(resolveQuery({ datasetId: "ds1" }, null, deps)).rejects.toBeInstanceOf(AuthError);
  });

  it("private dataset owner → ok", async () => {
    const { deps } = makeDeps({
      getDataset: async () => publicDataset({ visibility: "private", owner: "user_a" }),
    });
    const result = await resolveQuery({ datasetId: "ds1" }, { subject: "user_a" }, deps);
    expect(result).toMatchObject({ costTier: "A" });
  });

  it("rejects injection filter", async () => {
    const { deps } = makeDeps();
    await expect(
      resolveQuery({ datasetId: "ds1", filter: "1=1; DROP TABLE x" }, null, deps),
    ).rejects.toThrow(/Filter/);
  });

  it("not found", async () => {
    const { deps } = makeDeps({ getDataset: async () => null });
    await expect(resolveQuery({ datasetId: "missing" }, null, deps)).rejects.toThrow(/not found/i);
  });

  it("stale dataset throws", async () => {
    const { deps } = makeDeps({
      getDataset: async () => publicDataset({ stale: true, staleReason: "schema changed" } as never),
    });
    await expect(resolveQuery({ datasetId: "ds1" }, null, deps)).rejects.toThrow(/stale/i);
  });
});

describe("authorizeDataset writes", () => {
  it("requires owner for writes", () => {
    const ds = publicDataset({ owner: "a" });
    expect(() => authorizeDataset(ds, null, true)).toThrow(AuthError);
    expect(() => authorizeDataset(ds, { subject: "b" }, true)).toThrow(AuthError);
    expect(() => authorizeDataset(ds, { subject: "a" }, true)).not.toThrow();
  });
});

describe("derived helpers", () => {
  it("detects cycles", () => {
    const spec = {
      sources: [{ datasetId: "b", query: { datasetId: "b" } }],
      combine: { op: "single" as const },
      materialization: "auto" as const,
      followLatest: true,
    };
    expect(detectCycle("a", spec, (id) => (id === "b" ? ["a"] : undefined))).toBe(true);
    expect(detectCycle("a", spec, () => undefined)).toBe(false);
  });

  it("blocks public derived over private source", () => {
    expect(visibilityAllowed("public", [publicDataset({ visibility: "private" })])).toBe(false);
    expect(visibilityAllowed("public", [publicDataset()])).toBe(true);
    expect(visibilityAllowed("private", [publicDataset({ visibility: "private" })])).toBe(true);
  });

  it("auto policy: Case A → pointer", async () => {
    const { deps } = makeDeps({
      plan: {
        case: "A",
        matchedFiles: [],
        estimatedRows: 1,
        estimatedBytes: 1,
        reason: "A",
        partitionColumns: ["pickup_date"],
      },
    });
    const decision = await decideMaterialization(
      {
        sources: [
          {
            datasetId: "ds1",
            query: {
              datasetId: "ds1",
              columns: ["fare_amount"],
              filter: "pickup_date = '2024-01-01'",
            },
          },
        ],
        combine: { op: "single" },
        materialization: "auto",
        followLatest: true,
      },
      null,
      deps,
    );
    expect(decision.mode).toBe("pointer");
  });

  it("auto policy: join → materialized", async () => {
    const { deps } = makeDeps();
    const decision = await decideMaterialization(
      {
        sources: [
          { datasetId: "ds1", query: { datasetId: "ds1" } },
          { datasetId: "ds2", query: { datasetId: "ds2" } },
        ],
        combine: { op: "join", on: ["id"], how: "inner" },
        materialization: "auto",
        followLatest: true,
      },
      null,
      deps,
    );
    expect(decision.mode).toBe("materialized");
  });

  it("forced pointer/materialized and union", async () => {
    const { deps } = makeDeps();
    expect(
      (
        await decideMaterialization(
          {
            sources: [{ datasetId: "ds1", query: { datasetId: "ds1" } }],
            combine: { op: "single" },
            materialization: "pointer",
            followLatest: true,
          },
          null,
          deps,
        )
      ).mode,
    ).toBe("pointer");
    expect(
      (
        await decideMaterialization(
          {
            sources: [{ datasetId: "ds1", query: { datasetId: "ds1" } }],
            combine: { op: "single" },
            materialization: "materialized",
            followLatest: true,
          },
          null,
          deps,
        )
      ).mode,
    ).toBe("materialized");
    expect(
      (
        await decideMaterialization(
          {
            sources: [
              { datasetId: "ds1", query: { datasetId: "ds1" } },
              { datasetId: "ds2", query: { datasetId: "ds2" } },
            ],
            combine: { op: "union" },
            materialization: "auto",
            followLatest: true,
          },
          null,
          deps,
        )
      ).mode,
    ).toBe("materialized");
  });

  it("expandPointer memoizes and handles materialized", async () => {
    const base = publicDataset({ id: "base" });
    const mat = publicDataset({
      id: "mat",
      kind: "derived",
      materializationDecision: { mode: "materialized", reason: "x" },
      derivedSpec: {
        sources: [{ datasetId: "base", query: { datasetId: "base" } }],
        combine: { op: "single" },
        materialization: "materialized",
        followLatest: false,
      },
    });
    const ptr = publicDataset({
      id: "ptr",
      kind: "derived",
      materializationDecision: { mode: "pointer", reason: "cheap" },
      derivedSpec: {
        sources: [{ datasetId: "base", query: { datasetId: "base", columns: ["a"] } }],
        combine: { op: "single" },
        materialization: "pointer",
        followLatest: true,
      },
    });
    const get = async (id: string) =>
      (({ base, mat, ptr } as Record<string, DatasetRecord>)[id] ?? null);
    expect((await expandPointer(mat, get))[0]?.datasetId).toBe("mat");
    expect((await expandPointer(ptr, get))[0]?.datasetId).toBe("base");
    expect((await expandPointer(base, get))[0]?.datasetId).toBe("base");
  });
});
