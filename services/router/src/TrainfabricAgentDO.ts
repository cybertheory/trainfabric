/**
 * Per-user Trainfabric agent session — message history for the Home ask box.
 * Tool loop runs on the Worker (needs McpContext); this DO only persists the thread.
 */

export type AgentStoredMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: number;
  toolName?: string;
};

export class TrainfabricAgentDO implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/messages" && request.method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit") || "100"), 200);
      const messages = await this.load();
      return Response.json({ messages: messages.slice(-limit) });
    }

    if (path === "/append" && request.method === "POST") {
      const body = (await request.json()) as AgentStoredMessage | { messages: AgentStoredMessage[] };
      const current = await this.load();
      const next = Array.isArray((body as { messages?: AgentStoredMessage[] }).messages)
        ? [...current, ...((body as { messages: AgentStoredMessage[] }).messages)]
        : [...current, body as AgentStoredMessage];
      // Keep a short ephemeral window for the home shortcut.
      await this.state.storage.put("messages", next.slice(-24));
      return Response.json({ ok: true, count: Math.min(next.length, 24) });
    }

    if (path === "/clear" && request.method === "POST") {
      await this.state.storage.put("messages", []);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }

  private async load(): Promise<AgentStoredMessage[]> {
    return (await this.state.storage.get<AgentStoredMessage[]>("messages")) ?? [];
  }
}
