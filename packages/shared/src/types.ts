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
  /** When forking from a saved query, reuse its R2 artifact if present. */
  queryId?: string;
  resultR2Url?: string;
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

/** First-class saved query — reusable slice, publishable, forkable. */
export interface SavedQuery {
  id: string;
  owner: string;
  datasetId: string;
  name: string;
  visibility: Visibility;
  columns?: string[];
  filter?: string;
  snapshotId?: string;
  branch?: string;
  limit?: number;
  queryHash: string;
  r2Url?: string;
  costTier?: CostTier;
  rowCount?: number;
  sizeBytes?: number;
  lastRunAt: number;
  createdAt: number;
  updatedAt: number;
}

/** User↔dataset subscription (star-like sticky connection). */
export type ConnectionSource = "manual" | "query" | "sample" | "agent";

export interface DatasetConnection {
  userId: string;
  datasetId: string;
  source: ConnectionSource;
  createdAt: number;
}

export type SocialPostSource = "user" | "agent";

/**
 * A social identity, keyed by the auth subject (Clerk `sub` for humans,
 * agent-token subject for agents). Sourced from Clerk profile on the client
 * and merged server-side; agents get an auto-provisioned profile.
 */
export interface UserProfile {
  /** Auth subject: Clerk `sub` or agent-token subject. */
  userId: string;
  displayName: string;
  username?: string;
  imageUrl?: string;
  email?: string;
  bio?: string;
  /** True when this identity is an agent (autoresearch, MCP client, CLI token). */
  isAgent: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Partial profile update — only provided fields are written (merge semantics). */
export interface UpsertProfileRequest {
  displayName?: string;
  username?: string;
  imageUrl?: string;
  email?: string;
  bio?: string;
  isAgent?: boolean;
}

export interface SocialPost {
  id: string;
  authorId: string;
  authorName?: string;
  /** Denormalized author avatar at post time (from profile). */
  authorImage?: string;
  /** Denormalized author handle at post time (from profile). */
  authorUsername?: string;
  authorIsAgent?: boolean;
  datasetId: string;
  datasetOwner?: string;
  datasetName?: string;
  body: string;
  source: SocialPostSource;
  /** Optional structured findings from an agent (JSON-serializable). */
  findings?: Record<string, unknown>;
  createdAt: number;
}

export type NotificationKind =
  | "social_post"
  | "connection"
  | "job"
  | "info";

export interface AppNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string;
  postId?: string;
  datasetId?: string;
  read: boolean;
  createdAt: number;
}

export interface CreateSocialPostRequest {
  datasetId: string;
  body: string;
  source?: SocialPostSource;
  authorName?: string;
  findings?: Record<string, unknown>;
}

export const STREAM_SIZE_THRESHOLD_BYTES = 50 * 1024 * 1024;
export const DEFAULT_SAMPLE_ROWS = 20;
export const MAX_RESULT_ROWS = 10_000_000;

/* ── Autoresearch /auto ─────────────────────────────────────────── */

export type AutoRunStatus =
  | "pending"
  | "provisioning"
  | "running"
  | "awaiting_user"
  | "paused"
  | "done"
  | "error"
  | "cancelled";

export type AutoTrialStatus =
  | "pending"
  | "claimed"
  | "running"
  | "done"
  | "error"
  | "cancelled";

export type AutoComputeProvider = "modal" | "runner";

export interface AutoMetric {
  name: string;
  direction: "min" | "max";
}

export interface AutoBudget {
  maxTrials: number;
  maxWallClockSec: number;
  maxGpuSec?: number;
}

/**
 * Soft protocol: metric/budget/paths are set up front, but `snapshotId` is
 * bound once the agent (or human) picks a dataset. After the first dataset
 * bind the snapshot is frozen so trials stay comparable.
 */
export interface AutoProtocol {
  snapshotId?: string;
  metric: AutoMetric;
  budget: AutoBudget;
  mutablePaths: string[];
  immutablePaths: string[];
}

export interface AutoRepoBind {
  url: string;
  defaultBranch: string;
  /** GitHub App installation that owns clone/push credentials. */
  installationId?: number;
  /** owner/repo */
  fullName?: string;
  githubRepoId?: number;
  createdFromPlatform?: boolean;
  boxRepoSelected?: boolean;
  lastSyncedSha?: string;
}

export interface AutoBoxState {
  boxId?: string;
  templateId?: string;
  desktopUrl?: string;
  daemonHostUrl?: string;
  lastEventCursor?: string;
}

export interface AutoComputeConfig {
  provider: AutoComputeProvider;
  modalRef?: string;
  runnerId?: string;
}

export interface AutoProgress {
  trial: number;
  bestScore?: number;
  lastCommitSha?: string;
  updatedAt: number;
}

export interface AutoRun {
  id: string;
  /** Optional up front — the agent binds datasets at runtime via discovery. */
  datasetId?: string;
  /** Datasets the agent has bound (first bind freezes the protocol snapshot). */
  boundDatasets?: string[];
  /** Research brief loaded from the connected repo (TRAINFABRIC.md / AGENTS.md / README). */
  goal?: string;
  ownerId: string;
  status: AutoRunStatus;
  repo: AutoRepoBind;
  protocol: AutoProtocol;
  box: AutoBoxState;
  compute: AutoComputeConfig;
  progress: AutoProgress;
  resultRef?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/* ── Activity timeline + chat thread ─────────────────────────────── */

export type AutoActivityKind =
  | "status"
  | "dataset_bound"
  | "trial"
  | "message"
  | "box"
  | "note";

export interface AutoActivity {
  id: string;
  autoRunId: string;
  kind: AutoActivityKind;
  message: string;
  meta?: Record<string, unknown>;
  createdAt: number;
}

export type AutoMessageRole = "user" | "assistant" | "system" | "tool";
export type AutoMessageSource = "dashboard" | "mcp" | "api" | "daemon";

/**
 * A single message on an AutoRun's conversation thread. The same store backs
 * the dashboard chat (useChat), REST `/messages`, and MCP `message_auto_agent`
 * so humans and external/dev agents share one thread.
 */
export interface AutoMessage {
  id: string;
  autoRunId: string;
  role: AutoMessageRole;
  source: AutoMessageSource;
  content: string;
  createdAt: number;
  meta?: Record<string, unknown>;
}

export interface AutoTrial {
  id: string;
  autoRunId: string;
  status: AutoTrialStatus;
  hypothesis?: string;
  commitSha?: string;
  externalId?: string;
  score?: number;
  kept?: boolean;
  artifactRef?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AutoRunner {
  id: string;
  ownerId: string;
  name: string;
  tokenHash: string;
  capacity?: string;
  lastHeartbeatAt?: number;
  createdAt: number;
}

export interface CreateAutoRunRequest {
  /**
   * Optional brief override. Prefer encoding the goal in the connected repo
   * (TRAINFABRIC.md / AGENTS.md / README.md) — the daemon loads it after clone.
   */
  goal?: string;
  /**
   * Repo URL (https://github.com/owner/repo). Preferred when using a public
   * escape hatch; otherwise pass installationId + repoFullName.
   */
  repoUrl?: string;
  /** GitHub App installation id for authenticated clone/push. */
  installationId?: number;
  /** owner/repo — preferred with installationId. */
  repoFullName?: string;
  githubRepoId?: number;
  createdFromPlatform?: boolean;
  defaultBranch?: string;
  /** Optional starting-dataset hint; the agent may discover + bind others from the repo brief. */
  datasetId?: string;
  /**
   * Optional pre-selected datasets the agent should use.
   * When empty/omitted, the agent picks from the repo brief / description.
   * `datasetId` remains as the primary (first) for backward compatibility.
   */
  datasetIds?: string[];
  protocol: AutoProtocol;
  compute: AutoComputeConfig;
  templateId?: string;
}

export interface GithubConnectionStatus {
  configured: boolean;
  connected: boolean;
  login?: string;
  avatarUrl?: string;
  installationCount: number;
}

export interface CreateGithubRepoRequest {
  installationId: number;
  name: string;
  private?: boolean;
  description?: string;
  defaultBranch?: string;
}

export interface CreateGithubRepoResponse {
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  installationId: number;
  githubRepoId: number;
  private: boolean;
}

export interface ReportAutoInstructionsRequest {
  /** Research brief extracted from the repo (or an override). */
  content: string;
  /** File the brief was loaded from, e.g. TRAINFABRIC.md. */
  sourceFile?: string;
}

export interface BindAutoDatasetRequest {
  datasetId: string;
  /** Freeze this snapshot into the protocol (first bind). */
  snapshotId?: string;
  /** Why the agent chose it — surfaced in the activity timeline. */
  reason?: string;
}

export interface PostAutoMessageRequest {
  content: string;
  role?: AutoMessageRole;
  source?: AutoMessageSource;
  meta?: Record<string, unknown>;
}

export interface CompleteAutoTrialRequest {
  status: "done" | "error";
  score?: number;
  artifactRef?: string;
  error?: string;
  commitSha?: string;
  kept?: boolean;
}

export interface RegisterRunnerRequest {
  name: string;
  capacity?: string;
}

export interface RegisterRunnerResponse {
  runnerId: string;
  token: string;
}
