/**
 * Dashboard Trainfabric agent — LLM tool loop over the same MCP tools as /mcp.
 */

import { handleMcpTool, MCP_TOOLS, type McpContext } from "./mcp";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

const SYSTEM = `You are Trainfabric agent — the in-dashboard assistant for the Trainfabric lakehouse.
You automate dashboard tasks using tools (same MCP surface as Cursor/Claude agents).

Workflow:
1. discover_datasets for intent
2. inspect_schema / estimate_query before expensive work
3. query_slice or prompt_query for data
4. publish_dataset / create_derived_dataset / start_auto when asked
5. connect_dataset / list_social_feed / post_social_update for community

Be concise. Prefer actionable next steps and dataset ids. For long autoresearch campaigns use start_auto and tell the user to open /auto/:id. Do not invent dataset ids.`;

type GatewayEnv = {
  CF_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_ID?: string;
  CF_AI_GATEWAY_TOKEN?: string;
  CF_AI_GATEWAY_BASE?: string;
  CF_AI_MODEL?: string;
};

function gatewayUrl(env: GatewayEnv): { url: string; headers: Record<string, string>; model: string } | null {
  const token = env.CF_AI_GATEWAY_TOKEN?.trim();
  const account = env.CF_ACCOUNT_ID?.trim();
  const gateway = env.CF_AI_GATEWAY_ID?.trim() || "default";
  const model =
    env.CF_AI_MODEL?.trim() || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  let base = env.CF_AI_GATEWAY_BASE?.trim().replace(/\/$/, "");
  if (!base && account) {
    base = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`;
  }
  if (!base || !token) return null;
  return {
    url: `${base}/chat/completions`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "cf-aig-gateway-id": gateway,
    },
    model,
  };
}

function mcpToolsAsOpenAi() {
  return MCP_TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

async function chatCompletion(
  env: GatewayEnv,
  messages: ChatMessage[],
  tools: ReturnType<typeof mcpToolsAsOpenAi>,
): Promise<{
  content: string | null;
  tool_calls?: ChatMessage["tool_calls"];
}> {
  const gw = gatewayUrl(env);
  if (!gw) {
    throw new Error("Trainfabric agent AI Gateway is not configured (CF_AI_GATEWAY_TOKEN)");
  }
  const res = await fetch(gw.url, {
    method: "POST",
    headers: gw.headers,
    body: JSON.stringify({
      model: gw.model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI Gateway ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: ChatMessage["tool_calls"];
      };
    }>;
  };
  const msg = json.choices?.[0]?.message;
  return {
    content: msg?.content ?? null,
    tool_calls: msg?.tool_calls,
  };
}

function toolResultText(result: Awaited<ReturnType<typeof handleMcpTool>>): string {
  const parts = result.content
    ?.map((c) => ("text" in c ? String(c.text) : JSON.stringify(c)))
    .join("\n");
  if (result.structuredContent) {
    try {
      return `${parts || ""}\n${JSON.stringify(result.structuredContent)}`.trim();
    } catch {
      return parts || "";
    }
  }
  return parts || "(empty tool result)";
}

/**
 * Run one user turn with up to maxSteps tool calls. Returns final assistant text.
 */
export async function runTrainfabricAgentTurn(
  env: GatewayEnv,
  mcp: McpContext,
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  userText: string,
  opts?: { maxSteps?: number },
): Promise<string> {
  const maxSteps = opts?.maxSteps ?? 6;
  const tools = mcpToolsAsOpenAi();
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: "user", content: userText },
  ];

  for (let step = 0; step < maxSteps; step++) {
    const reply = await chatCompletion(env, messages, tools);
    if (reply.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: reply.content,
        tool_calls: reply.tool_calls,
      });
      for (const call of reply.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        let outText: string;
        try {
          const result = await handleMcpTool(call.function.name, args, mcp);
          outText = toolResultText(result);
        } catch (e) {
          outText = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: outText.slice(0, 12000),
        });
      }
      continue;
    }
    const text = (reply.content || "").trim();
    if (text) return text;
    return "I could not produce a reply. Try rephrasing or check AI Gateway configuration.";
  }
  return "I hit the tool-step limit. Ask a more specific question or continue in a new message.";
}
