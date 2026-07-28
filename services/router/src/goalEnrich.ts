/**
 * Enrich a short research goal into a TRAINFABRIC.md-style brief via AI Gateway.
 */

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
  const model = env.CF_AI_MODEL?.trim() || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
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

const SYSTEM = `You help researchers write a Trainfabric autoresearch brief (TRAINFABRIC.md).

Given a short goal draft, rewrite it into a clear brief the agent can follow after cloning the repo.

Rules:
- Output markdown only — no preamble or code fences around the whole doc.
- Start with "# Autoresearch brief"
- Include ## Goal (concrete, measurable), ## Dataset hints (what to discover/bind), and ## Constraints (what not to change).
- Keep it under 600 words. Be specific; do not invent dataset ids.
- Preserve the user's intent; expand vaguely worded goals into actionable research directions.`;

export async function enrichResearchGoal(
  env: GatewayEnv,
  draft: string,
  opts?: { repoFullName?: string; metric?: string },
): Promise<string> {
  const gw = gatewayUrl(env);
  if (!gw) {
    throw new Error("AI Gateway is not configured (CF_AI_GATEWAY_TOKEN)");
  }
  const draftTrim = draft.trim();
  if (draftTrim.length < 8) {
    throw new Error("goal draft too short");
  }
  const contextBits = [
    opts?.repoFullName ? `Repo: ${opts.repoFullName}` : null,
    opts?.metric ? `Protocol metric: ${opts.metric}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(gw.url, {
    method: "POST",
    headers: gw.headers,
    body: JSON.stringify({
      model: gw.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content:
            (contextBits ? `${contextBits}\n\n` : "") +
            `Draft goal:\n${draftTrim}\n\nRewrite as a research brief.`,
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI Gateway ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const out = (json.choices?.[0]?.message?.content || "").trim();
  if (!out) throw new Error("Empty enrichment response");
  return out.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "").trim();
}
