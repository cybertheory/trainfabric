/** MCP tool handlers — workflow-oriented agent interface. */

import type {
  QueryRequest,
  DerivedSpec,
  Visibility,
  SocialPost,
  DatasetConnection,
  CreateAutoRunRequest,
  AutoRun,
  AutoMessage,
} from "@trainfabric/shared";
import type { Identity, ResolverDeps, DatasetRecord } from "./resolver";
import { resolveQuery, authorizeDataset, AuthError, NotFoundError } from "./resolver";
import { discoverDatasets, type DiscoverConstraints } from "./discover";

export interface McpContext {
  identity: Identity | null;
  deps: ResolverDeps;
  listDatasets: (opts: {
    search?: string;
    tag?: string;
    includePrivateFor?: string;
  }) => Promise<DatasetRecord[]>;
  getSchema: (id: string) => Promise<unknown>;
  sample: (id: string, n: number) => Promise<unknown[]>;
  publish: (args: Record<string, unknown>) => Promise<{ datasetId: string; jobId: string }>;
  getJob: (id: string) => Promise<unknown>;
  createDerived: (args: {
    name: string;
    sources: unknown[];
    combine: unknown;
    materialization?: string;
    visibility: Visibility;
    description?: string;
    tags?: string[];
  }) => Promise<unknown>;
  previewDerived: (spec: DerivedSpec) => Promise<unknown>;
  getLineage: (id: string) => Promise<unknown>;
  promptQuery: (args: {
    dataset_id: string;
    prompt: string;
    execute?: boolean;
    snapshot?: string;
    namespace?: string;
  }) => Promise<unknown>;
  /** Auto-connect user after data access (query/sample). */
  autoConnect?: (datasetId: string, source: "query" | "sample" | "agent") => Promise<void>;
  postSocialUpdate?: (args: {
    datasetId: string;
    body: string;
    findings?: Record<string, unknown>;
    authorName?: string;
  }) => Promise<SocialPost>;
  connectDataset?: (datasetId: string) => Promise<{ connected: boolean }>;
  listFeed?: (limit?: number) => Promise<SocialPost[]>;
  listConnections?: () => Promise<DatasetConnection[]>;
  startAuto?: (args: {
    goal?: string;
    dataset_id?: string;
    repo_url: string;
    default_branch?: string;
    protocol: CreateAutoRunRequest["protocol"];
    compute: CreateAutoRunRequest["compute"];
    template_id?: string;
  }) => Promise<AutoRun>;
  checkAuto?: (auto_run_id: string) => Promise<unknown>;
  listAutoRuns?: (dataset_id: string) => Promise<AutoRun[]>;
  pauseAuto?: (auto_run_id: string, action?: "pause" | "resume" | "cancel") => Promise<AutoRun>;
  bindAutoDataset?: (
    auto_run_id: string,
    dataset_id: string,
    reason?: string,
  ) => Promise<AutoRun>;
  messageAutoAgent?: (
    auto_run_id: string,
    message: string,
  ) => Promise<{ userMessage: AutoMessage; assistantMessage: AutoMessage }>;
  listAutoMessages?: (auto_run_id: string, limit?: number) => Promise<AutoMessage[]>;
  ai?: unknown;
  vectorize?: unknown;
}

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
}

function ok(data: unknown, affordances: string[] = []): McpToolResult {
  const payload = affordances.length ? { ...(data as object), affordances } : data;
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export const MCP_TOOLS = [
  {
    name: "discover_datasets",
    description:
      "Find datasets matching an intent via keyword/tag (+ semantic ranking when available). Returns ranked candidates with why-this-matches.",
    inputSchema: {
      type: "object",
      properties: {
        intent: { type: "string" },
        constraints: {
          type: "object",
          properties: {
            tags: { type: "array", items: { type: "string" } },
            owner: { type: "string" },
          },
        },
      },
      required: ["intent"],
    },
  },
  {
    name: "inspect_schema",
    description:
      "Return SchemaContract plus queryability hints (partition columns = cheap Case A filters).",
    inputSchema: {
      type: "object",
      properties: { dataset_id: { type: "string" } },
      required: ["dataset_id"],
    },
  },
  {
    name: "estimate_query",
    description:
      "Dry-run scan-plan only. Returns costTier A/B, est rows/bytes, cacheHit, queryHash. No materialization.",
    inputSchema: {
      type: "object",
      properties: {
        dataset_id: { type: "string" },
        columns: { type: "array", items: { type: "string" } },
        filter: { type: "string" },
        snapshot: { type: "string" },
      },
      required: ["dataset_id"],
    },
  },
  {
    name: "query_slice",
    description: "Fetch an exact slice. Returns data/link + queryHash + refine affordances.",
    inputSchema: {
      type: "object",
      properties: {
        dataset_id: { type: "string" },
        columns: { type: "array", items: { type: "string" } },
        filter: { type: "string" },
        snapshot: { type: "string" },
        mode: { type: "string", enum: ["stream", "link"] },
        limit: { type: "number" },
      },
      required: ["dataset_id"],
    },
  },
  {
    name: "sample_dataset",
    description: "Cheap N-row peek without a full query.",
    inputSchema: {
      type: "object",
      properties: {
        dataset_id: { type: "string" },
        n: { type: "number" },
      },
      required: ["dataset_id"],
    },
  },
  {
    name: "publish_dataset",
    description: "Publish a staged data_ref. Returns dataset id + job handle.",
    inputSchema: {
      type: "object",
      properties: {
        data_ref: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        visibility: { type: "string", enum: ["public", "private"] },
        partition_hint: { type: "string" },
        sort_column: { type: "string" },
      },
      required: ["data_ref", "name"],
    },
  },
  {
    name: "check_job",
    description: "Poll ingest/materialize job status.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
    },
  },
  {
    name: "create_derived_dataset",
    description:
      "Create a derived dataset (pointer/materialized/auto) from one or more source queries.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        sources: { type: "array" },
        combine: { type: "object" },
        materialization: { type: "string", enum: ["pointer", "materialized", "auto"] },
        visibility: { type: "string", enum: ["public", "private"] },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["name", "sources", "combine", "visibility"],
    },
  },
  {
    name: "preview_derived",
    description:
      "Dry-run a DerivedSpec: resulting schema, estimate, pointer/materialize verdict. Creates nothing.",
    inputSchema: {
      type: "object",
      properties: { spec: { type: "object" } },
      required: ["spec"],
    },
  },
  {
    name: "get_lineage",
    description: "Upstream DAG for a dataset.",
    inputSchema: {
      type: "object",
      properties: { dataset_id: { type: "string" } },
      required: ["dataset_id"],
    },
  },
  {
    name: "prompt_query",
    description:
      "Natural-language slice via Hermes DuckDB skill. Inspects schema, estimates cost, generates columns+filter (and optional DuckDB SQL), then optionally executes.",
    inputSchema: {
      type: "object",
      properties: {
        dataset_id: { type: "string" },
        prompt: { type: "string" },
        execute: { type: "boolean" },
        snapshot: { type: "string" },
        namespace: { type: "string" },
      },
      required: ["dataset_id", "prompt"],
    },
  },
  {
    name: "post_social_update",
    description:
      "Publish a social update / research finding to a dataset community feed. Requires user auth (permission). Notifies users connected to that dataset. Use after autoresearch to share findings.",
    inputSchema: {
      type: "object",
      properties: {
        dataset_id: { type: "string" },
        body: { type: "string", description: "Human-readable update / finding summary" },
        findings: {
          type: "object",
          description: "Optional structured findings JSON for agents/downstream tools",
        },
        author_name: { type: "string", description: "Display name (e.g. agent or user label)" },
      },
      required: ["dataset_id", "body"],
    },
  },
  {
    name: "connect_dataset",
    description:
      "Connect (subscribe) the authenticated user to a dataset community — like starring. Connected users see feed updates and get notified.",
    inputSchema: {
      type: "object",
      properties: { dataset_id: { type: "string" } },
      required: ["dataset_id"],
    },
  },
  {
    name: "list_social_feed",
    description:
      "List recent social updates for datasets the user is connected to (or global public feed).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "start_auto",
    description:
      "Start a long-running autoresearch AutoRun (Box sandbox + Modal/HTTP GPU). Repo-first: connect a GitHub repo that contains the research brief (TRAINFABRIC.md / AGENTS.md / README.md) and protocol.yaml. The agent loads goals/instructions from the repo after clone and discovers datasets from that brief (dataset_id optional hint). Requires repo_url + experiment protocol (metric, budget, mutable/immutable paths). Does not replace prompt_query.",
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description:
            "Optional brief override. Prefer encoding the goal in the repo (TRAINFABRIC.md / AGENTS.md / README.md)",
        },
        dataset_id: { type: "string", description: "Optional starting-dataset hint" },
        repo_url: { type: "string", description: "GitHub repo that owns the research brief and code" },
        default_branch: { type: "string" },
        protocol: {
          type: "object",
          description:
            "{ metric:{name,direction}, budget:{maxTrials,maxWallClockSec}, mutablePaths, immutablePaths } — snapshotId is bound when a dataset is chosen",
        },
        compute: {
          type: "object",
          description: "{ provider: 'modal'|'runner', modalRef?, runnerId? }",
        },
        template_id: { type: "string" },
      },
      required: ["repo_url", "protocol", "compute"],
    },
  },
  {
    name: "bind_auto_dataset",
    description:
      "Bind a dataset the agent discovered (or the user confirmed) to an AutoRun. The first bind freezes the protocol snapshot so trials stay comparable, and moves an awaiting_user run into running.",
    inputSchema: {
      type: "object",
      properties: {
        auto_run_id: { type: "string" },
        dataset_id: { type: "string" },
        reason: { type: "string", description: "Why this dataset fits the repo brief" },
      },
      required: ["auto_run_id", "dataset_id"],
    },
  },
  {
    name: "message_auto_agent",
    description:
      "Send a message to a long-running cloud AutoRun agent and get its reply. Same conversation thread as the dashboard chat — use this so your (dev/Cursor) agent can steer or ask a cloud AutoRun. Persisted for all clients.",
    inputSchema: {
      type: "object",
      properties: {
        auto_run_id: { type: "string" },
        message: { type: "string" },
      },
      required: ["auto_run_id", "message"],
    },
  },
  {
    name: "list_auto_messages",
    description: "Read an AutoRun's conversation thread (poll for new messages).",
    inputSchema: {
      type: "object",
      properties: {
        auto_run_id: { type: "string" },
        limit: { type: "number" },
      },
      required: ["auto_run_id"],
    },
  },
  {
    name: "check_auto",
    description: "Poll AutoRun status, trials, and recent Box events.",
    inputSchema: {
      type: "object",
      properties: { auto_run_id: { type: "string" } },
      required: ["auto_run_id"],
    },
  },
  {
    name: "list_auto_runs",
    description: "List AutoRuns for a dataset.",
    inputSchema: {
      type: "object",
      properties: { dataset_id: { type: "string" } },
      required: ["dataset_id"],
    },
  },
  {
    name: "pause_auto",
    description: "Pause, resume, or cancel an AutoRun (Box stop/resume).",
    inputSchema: {
      type: "object",
      properties: {
        auto_run_id: { type: "string" },
        action: { type: "string", enum: ["pause", "resume", "cancel"] },
      },
      required: ["auto_run_id"],
    },
  },
] as const;

export async function handleMcpTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<McpToolResult> {
  switch (name) {
    case "discover_datasets": {
      const intent = String(args.intent ?? "");
      const constraints = args.constraints as DiscoverConstraints | undefined;
      const list = await ctx.listDatasets({
        search: intent,
        includePrivateFor: ctx.identity?.subject,
      });
      const hits = await discoverDatasets(
        intent,
        list,
        constraints,
        ctx.identity?.subject,
        ctx.ai as never,
        ctx.vectorize as never,
      );
      return ok({
        results: hits,
        next: hits[0]
          ? `Call inspect_schema on "${hits[0].dataset.id}" to see columns and cheap filters.`
          : "No matches — broaden intent or publish a dataset.",
      });
    }
    case "inspect_schema": {
      const id = String(args.dataset_id);
      const ds = await ctx.deps.getDataset(id);
      if (!ds) throw new NotFoundError();
      authorizeDataset(ds, ctx.identity);
      const schema = (await ctx.getSchema(id)) as {
        columns?: { name: string; isPartition: boolean }[];
        rowCount?: number;
        sizeBytes?: number;
        sampleRows?: unknown[];
        partitionColumns?: string[];
      } | null;
      const partitionCols =
        schema?.partitionColumns ??
        schema?.columns?.filter((c) => c.isPartition).map((c) => c.name) ??
        [];
      return ok(
        {
          schema,
          queryability: {
            partitionColumns: partitionCols,
            hint:
              partitionCols.length > 0
                ? `Filtering on ${partitionCols.join(", ")} likely hits Case A (zero compute).`
                : "No partition columns — most filters will be Case B (compute).",
          },
        },
        [
          "Next: estimate_query with a partition filter to check cost, then query_slice.",
        ],
      );
    }
    case "estimate_query": {
      const req: QueryRequest = {
        datasetId: String(args.dataset_id),
        columns: args.columns as string[] | undefined,
        filter: args.filter as string | undefined,
        snapshot: args.snapshot as string | undefined,
      };
      const estimate = await resolveQuery(req, ctx.identity, ctx.deps, { estimateOnly: true });
      const affordances: string[] = [];
      if ("costTier" in estimate && estimate.costTier === "B") {
        affordances.push(
          "This query is Case B (compute). Adding a partition-column filter may hit the fast path.",
        );
      }
      if ("cacheHit" in estimate && estimate.cacheHit) {
        affordances.push("Result already cached — query_slice will be free.");
      }
      return ok(estimate, affordances);
    }
    case "query_slice": {
      const req: QueryRequest = {
        datasetId: String(args.dataset_id),
        columns: args.columns as string[] | undefined,
        filter: args.filter as string | undefined,
        snapshot: args.snapshot as string | undefined,
        mode: args.mode as "stream" | "link" | undefined,
        limit: args.limit as number | undefined,
      };
      const result = await resolveQuery(req, ctx.identity, ctx.deps);
      await ctx.autoConnect?.(String(args.dataset_id), "agent");
      return ok(result, [
        ...(("affordances" in result && result.affordances) || []),
        "Refine: narrow columns/filter and re-estimate, or create_derived_dataset to reuse this slice.",
        "Share findings with post_social_update for the dataset community.",
      ]);
    }
    case "sample_dataset": {
      const id = String(args.dataset_id);
      const ds = await ctx.deps.getDataset(id);
      if (!ds) throw new NotFoundError();
      authorizeDataset(ds, ctx.identity);
      const rows = await ctx.sample(id, Number(args.n ?? 20));
      await ctx.autoConnect?.(id, "sample");
      return ok({ rows, next: "Use inspect_schema then estimate_query before a full slice." });
    }
    case "publish_dataset": {
      if (!ctx.identity) throw new AuthError("Auth required to publish");
      const out = await ctx.publish({
        data_ref: args.data_ref,
        name: args.name,
        description: args.description,
        tags: args.tags ?? [],
        visibility: args.visibility ?? "private",
        partition_hint: args.partition_hint,
        sort_column: args.sort_column,
        owner: ctx.identity.subject,
      });
      return ok({
        ...out,
        next: `Poll check_job with job_id="${out.jobId}" until status=done.`,
      });
    }
    case "check_job": {
      const job = await ctx.getJob(String(args.job_id));
      return ok({ job });
    }
    case "create_derived_dataset": {
      if (!ctx.identity) throw new AuthError("Auth required");
      const out = await ctx.createDerived({
        name: String(args.name),
        sources: args.sources as unknown[],
        combine: args.combine,
        materialization: args.materialization as string | undefined,
        visibility: (args.visibility as Visibility) ?? "private",
        description: args.description as string | undefined,
        tags: args.tags as string[] | undefined,
      });
      return ok(out);
    }
    case "preview_derived": {
      const out = await ctx.previewDerived(args.spec as DerivedSpec);
      return ok(out, ["Creates nothing — call create_derived_dataset to persist."]);
    }
    case "get_lineage": {
      const out = await ctx.getLineage(String(args.dataset_id));
      return ok(out);
    }
    case "prompt_query": {
      const id = String(args.dataset_id);
      const ds = await ctx.deps.getDataset(id);
      if (!ds) throw new NotFoundError();
      authorizeDataset(ds, ctx.identity);
      const out = await ctx.promptQuery({
        dataset_id: id,
        prompt: String(args.prompt ?? ""),
        execute: args.execute !== false,
        snapshot: args.snapshot as string | undefined,
        namespace: (args.namespace as string | undefined) ?? ds.icebergNamespace ?? "default",
      });
      if (args.execute !== false) await ctx.autoConnect?.(id, "agent");
      return ok(out, [
        "Hermes used duckdb-analytics: schema → estimate → DuckDB plan. Refine with estimate_query / query_slice if needed.",
        "Share findings with post_social_update for the dataset community.",
      ]);
    }
    case "post_social_update": {
      if (!ctx.identity) throw new AuthError("Auth required to post social updates (user permission)");
      if (!ctx.postSocialUpdate) throw new Error("Social store not configured");
      const body = String(args.body ?? "").trim();
      if (!body) throw new Error("body required");
      const ds = await ctx.deps.getDataset(String(args.dataset_id));
      if (!ds) throw new NotFoundError();
      authorizeDataset(ds, ctx.identity);
      const post = await ctx.postSocialUpdate({
        datasetId: String(args.dataset_id),
        body,
        findings: args.findings as Record<string, unknown> | undefined,
        authorName: args.author_name as string | undefined,
      });
      await ctx.autoConnect?.(String(args.dataset_id), "agent");
      return ok({
        post,
        share_url: `/posts/${post.id}`,
        next: "Connected users were notified. Share the post URL on X for discovery.",
      });
    }
    case "connect_dataset": {
      if (!ctx.identity) throw new AuthError("Auth required to connect");
      if (!ctx.connectDataset) throw new Error("Social store not configured");
      const ds = await ctx.deps.getDataset(String(args.dataset_id));
      if (!ds) throw new NotFoundError();
      authorizeDataset(ds, ctx.identity);
      const out = await ctx.connectDataset(String(args.dataset_id));
      return ok(out);
    }
    case "list_social_feed": {
      if (!ctx.listFeed) throw new Error("Social store not configured");
      const posts = await ctx.listFeed(Number(args.limit ?? 40));
      return ok({ posts });
    }
    case "start_auto": {
      if (!ctx.identity) throw new AuthError("Auth required to start AutoRun");
      if (!ctx.startAuto) throw new Error("Auto store not configured");
      const goal = args.goal as string | undefined;
      const datasetId = args.dataset_id ? String(args.dataset_id) : undefined;
      if (!args.repo_url) throw new Error("repo_url required — Autoresearch is repo-driven");
      if (datasetId) {
        const ds = await ctx.deps.getDataset(datasetId);
        if (!ds) throw new NotFoundError();
        authorizeDataset(ds, ctx.identity);
      }
      const run = await ctx.startAuto({
        goal,
        dataset_id: datasetId,
        repo_url: String(args.repo_url),
        default_branch: args.default_branch as string | undefined,
        protocol: args.protocol as CreateAutoRunRequest["protocol"],
        compute: args.compute as CreateAutoRunRequest["compute"],
        template_id: args.template_id as string | undefined,
      });
      if (datasetId) await ctx.autoConnect?.(datasetId, "agent");
      return ok({
        run,
        next: datasetId
          ? `Poll check_auto with auto_run_id="${run.id}". The agent clones the repo and runs trials.`
          : `Poll check_auto with auto_run_id="${run.id}". The agent loads TRAINFABRIC.md / AGENTS.md / README.md from the repo, then discovers and binds a dataset.`,
      });
    }
    case "bind_auto_dataset": {
      if (!ctx.identity) throw new AuthError("Auth required");
      if (!ctx.bindAutoDataset) throw new Error("Auto store not configured");
      const datasetId = String(args.dataset_id);
      const ds = await ctx.deps.getDataset(datasetId);
      if (!ds) throw new NotFoundError();
      authorizeDataset(ds, ctx.identity);
      const run = await ctx.bindAutoDataset(
        String(args.auto_run_id),
        datasetId,
        args.reason as string | undefined,
      );
      await ctx.autoConnect?.(datasetId, "agent");
      return ok({ run, next: `Dataset bound. Poll check_auto with auto_run_id="${run.id}".` });
    }
    case "message_auto_agent": {
      if (!ctx.identity) throw new AuthError("Auth required");
      if (!ctx.messageAutoAgent) throw new Error("Auto store not configured");
      const message = String(args.message ?? "").trim();
      if (!message) throw new Error("message required");
      const out = await ctx.messageAutoAgent(String(args.auto_run_id), message);
      return ok({
        reply: out.assistantMessage.content,
        userMessage: out.userMessage,
        assistantMessage: out.assistantMessage,
        next: "Poll list_auto_messages for further replies as the agent works.",
      });
    }
    case "list_auto_messages": {
      if (!ctx.listAutoMessages) throw new Error("Auto store not configured");
      const messages = await ctx.listAutoMessages(
        String(args.auto_run_id),
        args.limit as number | undefined,
      );
      return ok({ messages });
    }
    case "check_auto": {
      if (!ctx.checkAuto) throw new Error("Auto store not configured");
      const out = await ctx.checkAuto(String(args.auto_run_id));
      return ok(out);
    }
    case "list_auto_runs": {
      if (!ctx.listAutoRuns) throw new Error("Auto store not configured");
      const id = String(args.dataset_id);
      const ds = await ctx.deps.getDataset(id);
      if (!ds) throw new NotFoundError();
      authorizeDataset(ds, ctx.identity);
      const runs = await ctx.listAutoRuns(id);
      return ok({ runs });
    }
    case "pause_auto": {
      if (!ctx.identity) throw new AuthError("Auth required");
      if (!ctx.pauseAuto) throw new Error("Auto store not configured");
      const action = (args.action as "pause" | "resume" | "cancel") ?? "pause";
      const run = await ctx.pauseAuto(String(args.auto_run_id), action);
      return ok({ run });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
