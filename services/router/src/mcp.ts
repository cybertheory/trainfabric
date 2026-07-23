/** MCP tool handlers — workflow-oriented agent interface. */

import type { QueryRequest, DerivedSpec, Visibility } from "@trainfabric/shared";
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
      return ok(result, [
        ...(("affordances" in result && result.affordances) || []),
        "Refine: narrow columns/filter and re-estimate, or create_derived_dataset to reuse this slice.",
      ]);
    }
    case "sample_dataset": {
      const id = String(args.dataset_id);
      const ds = await ctx.deps.getDataset(id);
      if (!ds) throw new NotFoundError();
      authorizeDataset(ds, ctx.identity);
      const rows = await ctx.sample(id, Number(args.n ?? 20));
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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
