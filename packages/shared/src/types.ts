/** Shared contracts for the agent-native data lakehouse. */

export type Visibility = "public" | "private";
export type CostTier = "cache" | "A" | "B";
export type QueryMode = "stream" | "link";

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  nullRate?: number;
  distinctCount?: number;
  min?: string | number | null;
  max?: string | number | null;
  isPartition: boolean;
  description?: string;
}

export interface SchemaContract {
  datasetId: string;
  snapshotId: string;
  columns: ColumnSchema[];
  rowCount: number;
  sizeBytes: number;
  partitionColumns: string[];
  sampleRows: Record<string, unknown>[];
}

export interface DatasetMeta {
  id: string;
  owner: string;
  visibility: Visibility;
  name: string;
  description?: string;
  tags: string[];
  stars: number;
  latestSnapshotId: string;
  rowCount: number;
  sizeBytes: number;
  kind: "base" | "derived";
  createdAt: number;
  updatedAt: number;
}

export interface DerivedSource {
  datasetId: string;
  snapshotPin?: string;
  query: QueryRequest;
}

export type DerivedCombine =
  | { op: "single" }
  | { op: "union" }
  | { op: "join"; on: string[]; how: "inner" | "left" | "right" | "full" };

export type MaterializationMode = "pointer" | "materialized" | "auto";

export interface DerivedSpec {
  sources: DerivedSource[];
  combine: DerivedCombine;
  materialization: MaterializationMode;
  followLatest: boolean;
}

export interface QueryRequest {
  datasetId: string;
  columns?: string[];
  filter?: string;
  snapshot?: string;
  mode?: QueryMode;
  limit?: number;
  branch?: string;
}

export interface QueryEstimate {
  costTier: CostTier;
  estimatedRows: number;
  estimatedBytes: number;
  cacheHit: boolean;
  queryHash: string;
}

export interface QueryResult {
  queryHash: string;
  mode: QueryMode;
  url?: string;
  /** Present when mode is stream and payload is small enough. */
  arrowBase64?: string;
  /** Case A multi-range manifest. */
  manifest?: RangeManifest;
  costTier: CostTier;
  rowCount?: number;
  sizeBytes?: number;
  affordances?: string[];
}

export interface RangeEntry {
  file: string;
  ranges: [number, number][];
  columns: string[];
  url?: string;
}

export interface RangeManifest {
  entries: RangeEntry[];
  estimatedRows: number;
  estimatedBytes: number;
}

export interface ScanPlanResult {
  case: "A" | "B";
  matchedFiles: string[];
  estimatedRows: number;
  estimatedBytes: number;
  manifest?: RangeManifest;
  reason: string;
}

export interface ResultCacheEntry {
  queryHash: string;
  datasetId: string;
  r2Url: string;
  rowCount: number;
  sizeBytes: number;
  createdAt: number;
}

export type JobKind = "ingest" | "materialize" | "rebuild";
export type JobStatus = "pending" | "running" | "done" | "error";

export interface JobRecord {
  id: string;
  datasetId: string;
  kind: JobKind;
  status: JobStatus;
  resultRef?: string;
  error?: string;
  updatedAt: number;
  progress?: number;
}

export interface MaterializationDecision {
  mode: "pointer" | "materialized";
  reason: string;
  hybrid?: boolean;
}

export interface DatasetLineageNode {
  datasetId: string;
  name: string;
  kind: "base" | "derived";
  children: DatasetLineageNode[];
}

export interface CreateDerivedRequest {
  name: string;
  description?: string;
  tags?: string[];
  visibility: Visibility;
  spec: DerivedSpec;
}

export const STREAM_SIZE_THRESHOLD_BYTES = 50 * 1024 * 1024;
export const DEFAULT_SAMPLE_ROWS = 20;
export const MAX_RESULT_ROWS = 10_000_000;
