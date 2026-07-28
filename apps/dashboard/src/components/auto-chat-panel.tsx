"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publicApiOrigin } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";
import { cn } from "@/lib/utils";

type ServerMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  source: "dashboard" | "mcp" | "api" | "daemon";
  content: string;
  createdAt: number;
};

function toUiRole(role: ServerMessage["role"]): "user" | "assistant" | "system" {
  if (role === "user") return "user";
  if (role === "system") return "system";
  return "assistant";
}

function toUiMessages(items: ServerMessage[]): UIMessage[] {
  return items.map((m) => ({
    id: m.id,
    role: toUiRole(m.role),
    parts: [{ type: "text", text: m.content }],
    metadata: { source: m.source },
  })) as UIMessage[];
}

function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Chat with a long-running cloud AutoRun agent over Trainfabric's streaming
 * endpoint. Messages sent via MCP / REST by external agents land in the same
 * thread and appear here on poll.
 */
export function AutoChatPanel({ autoRunId }: { autoRunId: string }) {
  const { authToken } = useJobTracker();
  const tokenRef = useRef<string | null>(authToken);
  tokenRef.current = authToken;
  const origin = publicApiOrigin();
  const [input, setInput] = useState("");
  const [serverCount, setServerCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${origin}/auto/${autoRunId}/messages/stream`,
        headers: (): Record<string, string> =>
          tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {},
      }),
    [origin, autoRunId],
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    id: autoRunId,
    transport,
  });

  // Seed + reconcile with the shared server thread (picks up MCP/daemon/api messages).
  useEffect(() => {
    let cancelled = false;
    async function sync() {
      try {
        const res = await fetch(`${origin}/auto/${autoRunId}/messages?limit=200`, {
          headers: tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : undefined,
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { messages?: ServerMessage[] };
        const items = data.messages ?? [];
        // Only overwrite when idle and the server has more than we show, so we
        // don't clobber an in-flight optimistic send / stream.
        if (status === "ready" && items.length > messages.length) {
          setMessages(toUiMessages(items));
        }
        setServerCount(items.length);
      } catch {
        /* keep the local view */
      }
    }
    void sync();
    const iv = window.setInterval(() => void sync(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [origin, autoRunId, status, messages.length, setMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  }

  return (
    <div className="tf-inset flex h-full min-h-[420px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border-subtle))] px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          Shared with MCP · {serverCount} message{serverCount === 1 ? "" : "s"}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Talk to the agent — ask for status, suggest a dataset, or nudge the next trial. The same
            thread is available from MCP via <code>message_auto_agent</code>.
          </p>
        ) : (
          messages.map((m) => {
            const source = (m.metadata as { source?: string } | undefined)?.source;
            const isUser = m.role === "user";
            const isSystem = m.role === "system";
            return (
              <div
                key={m.id}
                className={cn("flex flex-col gap-0.5", isUser ? "items-end" : "items-start")}
              >
                <span className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {isUser ? "you" : isSystem ? "system" : "agent"}
                  {source && source !== "dashboard" ? ` · ${source}` : ""}
                </span>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                    isUser
                      ? "bg-primary text-primary-foreground"
                      : isSystem
                        ? "border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] text-muted-foreground"
                        : "bg-[hsl(var(--elevated))] text-foreground",
                  )}
                >
                  {messageText(m) || (busy ? "…" : "")}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Message the agent…"
          rows={2}
          className="flex-1 resize-none rounded-md border border-[hsl(var(--border-strong))] bg-[hsl(var(--inset))] px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <Button type="button" size="icon" disabled={busy || !input.trim()} onClick={submit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
