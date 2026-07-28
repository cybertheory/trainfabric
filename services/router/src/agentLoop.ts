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

const SYSTEM = `You are Trainfabric agent — the friendly in-dashboard co-pilot for the Trainfabric lakehouse and autoresearch agents.

Tone:
- Warm, concrete, and brief. Never say the user's input is "insufficient" or ask them to "provide more details" without offering options.
- On greetings (hi/hello/hey) or vague asks, welcome them and suggest 2–4 concrete next steps with example prompts they can paste.
- Prefer doing useful work with tools over asking clarifying questions.

What you can help with:
- Discover and inspect datasets (discover_datasets, inspect_schema, sample_dataset)
- Query slices and natural-language questions (estimate_query, query_slice, prompt_query)
- Publish / derive datasets
- Start and check autoresearch AutoRuns (start_auto, check_auto, list_auto_runs) — GPU trials use trainfabric_gpu or a self-hosted runner
- Community: connect_dataset, list_social_feed, post_social_update

Workflow when the user has a real task:
1. discover_datasets for intent (or use an id they give)
2. inspect_schema / estimate_query before expensive work
3. query_slice or prompt_query for data
4. publish_dataset / create_derived_dataset / start_auto when asked
5. For running campaigns, check_auto / list_auto_runs and point them to /auto/:id

Rules:
- Be concise. Prefer actionable next steps and real dataset / auto_run ids from tools.
- Do not invent dataset ids or auto_run ids.
- If tools fail, say what failed and offer a fallback path (Discover, Agents, Docs).`;

const SOFT_OPENER =
  /^(hi|hello|hey|yo|sup|howdy|hiya|good\s*(morning|afternoon|evening)|help|what can you do|what do you do|how does this work|who are you)\b/i;

function isSoftOpener(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (SOFT_OPENER.test(t)) return true;
  // Very short / vague with no domain nouns
  if (
    t.length <= 16 &&
    !/\b(dataset|query|publish|auto|agent|gpu|runner|schema|sample|discover|start)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

function softOpenerReply(): string {
  return [
    "Hey — I'm the Trainfabric agent. I can help you explore data, run queries, publish datasets, or steer GPU autoresearch.",
    "",
    "Try one of these:",
    '• "Find datasets about NYC taxi fares"',
    '• "Sample anon/nyc-taxi-1k"',
    '• "List my AutoRuns"',
    '• "Start an agent on my taxi repo"',
    "",
    "Or use Discover / Start agent / GPU runs in the nav. What do you want to do?",
  ].join("\n");
}

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

function sanitizeAssistantContent(content: string | null | undefined, hasTools: boolean): string | null {
  if (hasTools) {
    const t = (content ?? "").trim();
    return t ? t : null;
  }
  return content ?? null;
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
  // Workers AI is picky: normalize prior assistant tool turns to content:null
  const normalized = messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        ...m,
        content: sanitizeAssistantContent(m.content, true),
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments:
              typeof tc.function.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments ?? {}),
          },
        })),
      };
    }
    if (m.role === "assistant" || m.role === "user" || m.role === "system") {
      return { ...m, content: m.content ?? "" };
    }
    return m;
  });

  const res = await fetch(gw.url, {
    method: "POST",
    headers: gw.headers,
    body: JSON.stringify({
      model: gw.model,
      messages: normalized,
      tools,
      tool_choice: "auto",
      temperature: 0.35,
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

/** Format tool results into a readable reply when the model can't take another turn. */
function summarizeToolBatch(
  calls: NonNullable<ChatMessage["tool_calls"]>,
  results: string[],
): string {
  const chunks: string[] = [];
  for (let i = 0; i < calls.length; i++) {
    const name = calls[i]?.function.name || "tool";
    const raw = results[i] || "";
    let preview = raw.slice(0, 900);
    try {
      const parsed = JSON.parse(raw) as unknown;
      preview = JSON.stringify(parsed, null, 2).slice(0, 900);
    } catch {
      /* keep text */
    }
    chunks.push(`**${name}**\n\`\`\`\n${preview}\n\`\`\``);
  }
  return (
    "Here's what I found:\n\n" +
    chunks.join("\n\n") +
    "\n\nTell me what to do next (query a slice, start an agent, or dig into a dataset id)."
  );
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
  if (isSoftOpener(userText)) {
    return softOpenerReply();
  }

  const maxSteps = opts?.maxSteps ?? 6;
  const tools = mcpToolsAsOpenAi();
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: "user", content: userText },
  ];

  let lastToolCalls: NonNullable<ChatMessage["tool_calls"]> | undefined;
  let lastToolResults: string[] = [];

  try {
    for (let step = 0; step < maxSteps; step++) {
      let reply: Awaited<ReturnType<typeof chatCompletion>>;
      try {
        reply = await chatCompletion(env, messages, tools);
      } catch (e) {
        // Workers AI often 400s on multi-turn tool results — still surface tool output.
        if (lastToolCalls?.length) {
          return summarizeToolBatch(lastToolCalls, lastToolResults);
        }
        throw e;
      }

      if (reply.tool_calls?.length) {
        messages.push({
          role: "assistant",
          content: sanitizeAssistantContent(reply.content, true),
          tool_calls: reply.tool_calls,
        });
        const resultTexts: string[] = [];
        for (const call of reply.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          } catch {
            args = {};
          }
          let outText: string;
          try {
            outText = toolResultText(await handleMcpTool(call.function.name, args, mcp));
          } catch (e) {
            outText = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
          }
          resultTexts.push(outText);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: outText.slice(0, 12000),
          });
        }
        lastToolCalls = reply.tool_calls;
        lastToolResults = resultTexts;
        continue;
      }

      const text = (reply.content || "").trim();
      if (text) {
        if (/not sufficient|provide more details|specify the task/i.test(text) && text.length < 200) {
          return softOpenerReply();
        }
        return text;
      }
      if (lastToolCalls?.length) {
        return summarizeToolBatch(lastToolCalls, lastToolResults);
      }
      return softOpenerReply();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/AI Gateway|not configured/i.test(msg)) {
      return (
        "I couldn't reach the AI Gateway just now. You can still use Discover, Start agent, " +
        "or GPU runs from the nav — or try again in a moment.\n\n" +
        `(${msg.slice(0, 160)})`
      );
    }
    throw e;
  }

  if (lastToolCalls?.length) {
    return summarizeToolBatch(lastToolCalls, lastToolResults);
  }
  return "I hit the tool-step limit. Ask a more specific question or continue in a new message.";
}
