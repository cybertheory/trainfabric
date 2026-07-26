import type {
  CostTier,
  DatasetMeta,
  QueryEstimate,
  QueryMode,
  QueryRequest,
  QueryResult,
  RangeManifest,
  SchemaContract,
} from "@trainfabric/shared";
import { hashQueryRequest, validateFilter, FilterValidationError } from "@trainfabric/shared";

export interface Identity {
  subject: string;
  email?: string;
  /** Full name / display name from the identity provider (Clerk `name`). */
  name?: string;
  /** Handle from the identity provider (Clerk `preferred_username` / `username`). */
  username?: string;
  /** Avatar URL from the identity provider (Clerk `picture` / `image_url`). */
  imageUrl?: string;
}

export interface DatasetRecord extends DatasetMeta {
  schema?: SchemaContract;
  derivedSpec?: unknown;
  materializationDecision?: { mode: "pointer" | "materialized"; reason: string };
  stale?: boolean;
  staleReason?: string;
  icebergNamespace?: string;
  icebergTable?: string;
}

export interface CacheEntry {
  queryHash: string;
  datasetId: string;
  snapshotId: string;
  r2Url: string;
  rowCount: number;
  sizeBytes: number;
}

export interface ScanPlan {
  case: "A" | "B";
  matchedFiles: string[];
  estimatedRows: number;
  estimatedBytes: number;
  manifest?: RangeManifest;
  reason: string;
  partitionColumns: string[];
}

export interface ComputeQueryResult {
  mode: QueryMode;
  arrowBase64?: string;
  r2Path?: string;
  rowCount: number;
  sizeBytes: number;
}

export interface ResolverDeps {
  getDataset: (id: string) => Promise<DatasetRecord | null>;
  lookupCache: (queryHash: string) => Promise<CacheEntry | null>;
  upsertCache: (entry: CacheEntry) => Promise<void>;
  scanPlan: (req: QueryRequest & { namespace?: string }) => Promise<ScanPlan>;
  query: (req: QueryRequest & { namespace?: string; queryHash: string }) => Promise<ComputeQueryResult>;
  presign: (r2Url: string) => Promise<string>;
  recordHistory?: (opts: {
    datasetId: string;
    queryHash: string;
    costTier: CostTier;
    identity?: Identity;
  }) => Promise<void>;
  /** When true, skip Container calls (for estimate-only dry runs that still need plan). */
  dryRun?: boolean;
}

export class AuthError extends Error {
  status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthError";
  }
}

export class NotFoundError extends Error {
  status = 404;
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export function authorizeDataset(
  dataset: DatasetRecord,
  identity: Identity | null | undefined,
  write = false,
): void {
  if (write) {
    if (!identity || identity.subject !== dataset.owner) {
      throw new AuthError("Owner identity required for writes");
    }
    return;
  }
  if (dataset.visibility === "public") return;
  if (!identity || identity.subject !== dataset.owner) {
    throw new AuthError("Private dataset");
  }
}

export interface ResolveOptions {
  estimateOnly?: boolean;
}

/**
 * Core query resolver — shared by REST and MCP.
 *
 * 1. authorize
 * 2. cache lookup by query hash
 * 3. scan-plan → Case A (zero compute) or Case B (DuckDB)
 */
export async function resolveQuery(
  req: QueryRequest,
  identity: Identity | null | undefined,
  deps: ResolverDeps,
  opts: ResolveOptions = {},
): Promise<QueryResult | QueryEstimate> {
  validateFilter(req.filter);

  const dataset = await deps.getDataset(req.datasetId);
  if (!dataset) throw new NotFoundError(`Dataset ${req.datasetId} not found`);
  authorizeDataset(dataset, identity);

  if (dataset.stale) {
    throw new Error(`Dataset is stale: ${(dataset as { staleReason?: string }).staleReason ?? "source schema changed"}`);
  }

  const snapshotId = req.snapshot || dataset.latestSnapshotId || "0";
  const qh = await hashQueryRequest(req, snapshotId);

  const cached = await deps.lookupCache(qh);
  if (cached) {
    if (opts.estimateOnly) {
      return {
        costTier: "cache",
        estimatedRows: cached.rowCount,
        estimatedBytes: cached.sizeBytes,
        cacheHit: true,
        queryHash: qh,
      } satisfies QueryEstimate;
    }
    const url = await deps.presign(cached.r2Url);
    await deps.recordHistory?.({
      datasetId: req.datasetId,
      queryHash: qh,
      costTier: "cache",
      identity: identity ?? undefined,
    });
    return {
      queryHash: qh,
      mode: "link",
      url,
      costTier: "cache",
      rowCount: cached.rowCount,
      sizeBytes: cached.sizeBytes,
    } satisfies QueryResult;
  }

  const namespace = dataset.icebergNamespace ?? "default";
  const plan = await deps.scanPlan({ ...req, namespace });

  if (opts.estimateOnly) {
    return {
      costTier: plan.case,
      estimatedRows: plan.estimatedRows,
      estimatedBytes: plan.estimatedBytes,
      cacheHit: false,
      queryHash: qh,
    } satisfies QueryEstimate;
  }

  if (plan.case === "A") {
    const affordances: string[] = [];
    if (plan.partitionColumns.length) {
      affordances.push(`Partition columns (cheap filters): ${plan.partitionColumns.join(", ")}`);
    }
    // Presign first file for convenience; full manifest includes ranges
    let url: string | undefined;
    if (plan.matchedFiles[0]) {
      url = await deps.presign(plan.matchedFiles[0]);
    }
    if (plan.manifest) {
      for (const entry of plan.manifest.entries) {
        entry.url = await deps.presign(entry.file);
      }
    }
    await deps.recordHistory?.({
      datasetId: req.datasetId,
      queryHash: qh,
      costTier: "A",
      identity: identity ?? undefined,
    });
    return {
      queryHash: qh,
      mode: req.mode ?? "link",
      url,
      manifest: plan.manifest,
      costTier: "A",
      rowCount: plan.estimatedRows,
      sizeBytes: plan.estimatedBytes,
      affordances,
    } satisfies QueryResult;
  }

  // Case B
  const nonPartHint =
    plan.reason.includes("non-partition") || plan.reason.includes("non-partitioned")
      ? [plan.reason]
      : [`Case B: ${plan.reason}`];

  const result = await deps.query({
    ...req,
    namespace,
    queryHash: qh,
  });

  let url: string | undefined;
  if (result.r2Path) {
    await deps.upsertCache({
      queryHash: qh,
      datasetId: req.datasetId,
      snapshotId,
      r2Url: result.r2Path,
      rowCount: result.rowCount,
      sizeBytes: result.sizeBytes,
    });
    url = await deps.presign(result.r2Path);
  }

  await deps.recordHistory?.({
    datasetId: req.datasetId,
    queryHash: qh,
    costTier: "B",
    identity: identity ?? undefined,
  });

  return {
    queryHash: qh,
    mode: result.mode,
    url,
    arrowBase64: result.arrowBase64,
    costTier: "B",
    rowCount: result.rowCount,
    sizeBytes: result.sizeBytes,
    affordances: nonPartHint,
  } satisfies QueryResult;
}

export { FilterValidationError };
