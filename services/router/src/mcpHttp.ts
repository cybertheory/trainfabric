/** Proper Streamable HTTP MCP endpoint via agents + @modelcontextprotocol/sdk. */

import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleMcpTool, MCP_TOOLS, type McpContext, type McpToolResult } from "./mcp";

function asToolResult(result: McpToolResult) {
  return {
    content: result.content,
    structuredContent: result.structuredContent as Record<string, unknown> | undefined,
  };
}

function asToolError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

function registerTools(server: McpServer, ctx: McpContext) {
  const run = async (name: string, args: Record<string, unknown>) => {
    try {
      return asToolResult(await handleMcpTool(name, args, ctx));
    } catch (e) {
      return asToolError(e);
    }
  };

  server.registerTool(
    "discover_datasets",
    {
      description:
        "Find datasets matching an intent via keyword/tag (+ semantic ranking when available). Returns ranked candidates with why-this-matches.",
      inputSchema: {
        intent: z.string(),
        constraints: z
          .object({
            tags: z.array(z.string()).optional(),
            owner: z.string().optional(),
          })
          .optional(),
      },
    },
    async (args) => run("discover_datasets", args as Record<string, unknown>),
  );

  server.registerTool(
    "inspect_schema",
    {
      description:
        "Return SchemaContract plus queryability hints (partition columns = cheap Case A filters).",
      inputSchema: { dataset_id: z.string() },
    },
    async (args) => run("inspect_schema", args as Record<string, unknown>),
  );

  server.registerTool(
    "estimate_query",
    {
      description:
        "Dry-run scan-plan only. Returns cost tiers A/B, est rows/bytes, cacheHit, queryHash. No materialization.",
      inputSchema: {
        dataset_id: z.string(),
        columns: z.array(z.string()).optional(),
        filter: z.string().optional(),
        snapshot: z.string().optional(),
      },
    },
    async (args) => run("estimate_query", args as Record<string, unknown>),
  );

  server.registerTool(
    "query_slice",
    {
      description: "Fetch an exact slice. Returns data/link + queryHash + refine affordances.",
      inputSchema: {
        dataset_id: z.string(),
        columns: z.array(z.string()).optional(),
        filter: z.string().optional(),
        snapshot: z.string().optional(),
        mode: z.enum(["stream", "link"]).optional(),
        limit: z.number().optional(),
      },
    },
    async (args) => run("query_slice", args as Record<string, unknown>),
  );

  server.registerTool(
    "sample_dataset",
    {
      description: "Cheap N-row peek without a full query.",
      inputSchema: {
        dataset_id: z.string(),
        n: z.number().optional(),
      },
    },
    async (args) => run("sample_dataset", args as Record<string, unknown>),
  );

  server.registerTool(
    "publish_dataset",
    {
      description: "Publish a staged data_ref. Returns dataset id + job handle.",
      inputSchema: {
        data_ref: z.string(),
        name: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        visibility: z.enum(["public", "private"]).optional(),
        partition_hint: z.string().optional(),
        sort_column: z.string().optional(),
      },
    },
    async (args) => run("publish_dataset", args as Record<string, unknown>),
  );

  server.registerTool(
    "check_job",
    {
      description: "Poll ingest/materialize job status.",
      inputSchema: { job_id: z.string() },
    },
    async (args) => run("check_job", args as Record<string, unknown>),
  );

  server.registerTool(
    "create_derived_dataset",
    {
      description:
        "Create a derived dataset (pointer/materialized/auto) from one or more source queries.",
      inputSchema: {
        name: z.string(),
        sources: z.array(z.unknown()),
        combine: z.record(z.unknown()),
        materialization: z.enum(["pointer", "materialized", "auto"]).optional(),
        visibility: z.enum(["public", "private"]),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async (args) => run("create_derived_dataset", args as Record<string, unknown>),
  );

  server.registerTool(
    "preview_derived",
    {
      description:
        "Dry-run a DerivedSpec: resulting schema, estimate, pointer/materialize verdict. Creates nothing.",
      inputSchema: { spec: z.record(z.unknown()) },
    },
    async (args) => run("preview_derived", args as Record<string, unknown>),
  );

  server.registerTool(
    "get_lineage",
    {
      description: "Upstream DAG for a dataset.",
      inputSchema: { dataset_id: z.string() },
    },
    async (args) => run("get_lineage", args as Record<string, unknown>),
  );

  server.registerTool(
    "prompt_query",
    {
      description:
        "Natural-language slice via Hermes DuckDB skill. Inspects schema, estimates cost, generates columns+filter (and optional DuckDB SQL), then optionally executes.",
      inputSchema: {
        dataset_id: z.string(),
        prompt: z.string(),
        execute: z.boolean().optional(),
        snapshot: z.string().optional(),
        namespace: z.string().optional(),
      },
    },
    async (args) => run("prompt_query", args as Record<string, unknown>),
  );

  server.registerTool(
    "post_social_update",
    {
      description:
        "Post a research update to a dataset community feed (auth required).",
      inputSchema: {
        dataset_id: z.string(),
        body: z.string(),
        findings: z.record(z.unknown()).optional(),
        source: z.enum(["user", "agent"]).optional(),
        author_name: z.string().optional(),
      },
    },
    async (args) => run("post_social_update", args as Record<string, unknown>),
  );

  server.registerTool(
    "connect_dataset",
    {
      description: "Connect (subscribe) or disconnect the current user to a dataset community.",
      inputSchema: {
        dataset_id: z.string(),
        connect: z.boolean().optional(),
      },
    },
    async (args) => run("connect_dataset", args as Record<string, unknown>),
  );

  server.registerTool(
    "list_social_feed",
    {
      description: "List social feed posts for connected datasets (or a specific dataset).",
      inputSchema: {
        dataset_id: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async (args) => run("list_social_feed", args as Record<string, unknown>),
  );

  server.registerTool(
    "start_auto",
    {
      description:
        "Start a long-running autoresearch AutoRun (Box + Trainfabric GPU / HTTP runner). Repo-first: GitHub App install or public repo URL with research brief (TRAINFABRIC.md / AGENTS.md / README.md). Prefer repo_full_name + installation_id for private clone/push.",
      inputSchema: {
        goal: z.string().optional(),
        dataset_id: z.string().optional(),
        dataset_ids: z.array(z.string()).optional(),
        repo_url: z.string().optional(),
        repo_full_name: z.string().optional(),
        installation_id: z.number().optional(),
        default_branch: z.string().optional(),
        protocol: z.record(z.unknown()),
        compute: z.record(z.unknown()),
        template_id: z.string().optional(),
      },
    },
    async (args) => run("start_auto", args as Record<string, unknown>),
  );

  server.registerTool(
    "register_gpu_runner",
    {
      description:
        "Register a self-hosted HTTP GPU runner. Returns runnerId + one-time token and docker_run. Public runner: https://github.com/cybertheory/trainfabric-gpu-runner",
      inputSchema: {
        name: z.string(),
        capacity: z.string().optional(),
      },
    },
    async (args) => run("register_gpu_runner", args as Record<string, unknown>),
  );

  server.registerTool(
    "list_gpu_runners",
    {
      description: "List GPU runners for the signed-in user (use id with start_auto compute.runnerId).",
      inputSchema: {},
    },
    async (args) => run("list_gpu_runners", args as Record<string, unknown>),
  );

  server.registerTool(
    "bind_auto_dataset",
    {
      description:
        "Bind a dataset (agent-discovered or user-confirmed) to an AutoRun; freezes the protocol snapshot on first bind.",
      inputSchema: {
        auto_run_id: z.string(),
        dataset_id: z.string(),
        reason: z.string().optional(),
      },
    },
    async (args) => run("bind_auto_dataset", args as Record<string, unknown>),
  );

  server.registerTool(
    "message_auto_agent",
    {
      description:
        "Send a message to a long-running cloud AutoRun agent and get its reply. Same thread as the dashboard chat — lets a dev/Cursor agent steer a cloud AutoRun.",
      inputSchema: {
        auto_run_id: z.string(),
        message: z.string(),
      },
    },
    async (args) => run("message_auto_agent", args as Record<string, unknown>),
  );

  server.registerTool(
    "list_auto_messages",
    {
      description: "Read an AutoRun's conversation thread (poll for new messages).",
      inputSchema: {
        auto_run_id: z.string(),
        limit: z.number().optional(),
      },
    },
    async (args) => run("list_auto_messages", args as Record<string, unknown>),
  );

  server.registerTool(
    "check_auto",
    {
      description: "Poll AutoRun status and trials.",
      inputSchema: { auto_run_id: z.string() },
    },
    async (args) => run("check_auto", args as Record<string, unknown>),
  );

  server.registerTool(
    "list_auto_runs",
    {
      description: "List AutoRuns for a dataset.",
      inputSchema: { dataset_id: z.string() },
    },
    async (args) => run("list_auto_runs", args as Record<string, unknown>),
  );

  server.registerTool(
    "pause_auto",
    {
      description: "Pause, resume, or cancel an AutoRun.",
      inputSchema: {
        auto_run_id: z.string(),
        action: z.enum(["pause", "resume", "cancel"]).optional(),
      },
    },
    async (args) => run("pause_auto", args as Record<string, unknown>),
  );
}

/**
 * Handle MCP traffic for any compliant client (Cursor, Claude, Inspector, etc.).
 * Uses Streamable HTTP via Cloudflare Agents `createMcpHandler`.
 */
export async function handleTrainfabricMcp(
  request: Request,
  env: unknown,
  execCtx: ExecutionContext,
  getContext: (request: Request) => Promise<McpContext> | McpContext,
): Promise<Response> {
  const url = new URL(request.url);

  // Back-compat discovery used by docs / quickstart curls
  if (url.pathname === "/mcp/tools" && request.method === "GET") {
    return Response.json({ tools: MCP_TOOLS });
  }

  const ctx = await getContext(request);
  const server = new McpServer({
    name: "trainfabric",
    version: "0.1.0",
  });
  registerTools(server, ctx);

  return createMcpHandler(server, {
    route: "/mcp",
    // Stateless Streamable HTTP — each request is self-contained (no DO session).
    sessionIdGenerator: undefined,
    // Prefer JSON responses so clients that don't consume SSE still work.
    enableJsonResponse: true,
    corsOptions: {
      origin: "*",
      methods: "GET,POST,DELETE,OPTIONS",
      headers: "Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID",
      exposeHeaders: "Mcp-Session-Id",
      maxAge: 86400,
    },
  })(request, env, execCtx);
}
