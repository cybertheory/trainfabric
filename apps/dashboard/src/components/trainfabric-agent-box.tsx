"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { BookOpen, Bot, Database, Loader2, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publicApiOrigin } from "@/lib/api";
import { cn } from "@/lib/utils";

type ServerMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: number;
};

function toUiMessages(items: ServerMessage[]): UIMessage[] {
  return items.map((m) => ({
    id: m.id,
    role: m.role === "user" ? "user" : m.role === "system" ? "system" : "assistant",
    parts: [{ type: "text", text: m.content }],
  })) as UIMessage[];
}

function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Home hero — Trainfabric agent ask box (MCP tool loop on the router).
 */
export function TrainfabricAgentBox({ token }: { token?: string | null }) {
  const tokenRef = useRef<string | null>(token ?? null);
  tokenRef.current = token ?? null;
  const origin = publicApiOrigin();
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${origin}/agent/messages/stream`,
        headers: (): Record<string, string> =>
          tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {},
      }),
    [origin],
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    id: "trainfabric-agent-home",
    transport,
  });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function sync() {
      try {
        const res = await fetch(`${origin}/agent/messages?limit=40`, {
          headers: tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : undefined,
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { messages?: ServerMessage[] };
        const items = (data.messages ?? []).filter(
          (m) => m.role === "user" || m.role === "assistant" || m.role === "system",
        );
        if (status === "ready" && items.length > messages.length) {
          setMessages(toUiMessages(items));
          if (items.length) setExpanded(true);
        }
      } catch {
        /* keep local */
      }
    }
    void sync();
  }, [origin, token, status, messages.length, setMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  function submit(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    if (!token) return;
    setExpanded(true);
    setInput("");
    void sendMessage({ text });
  }

  const showThread = expanded || messages.length > 0;

  return (
    <section className="tf-elevated overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[hsl(var(--border-subtle))] px-4 py-2.5">
        <Bot className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold tracking-tight">Trainfabric agent</span>
        <span className="text-[11px] text-muted-foreground">discover · query · publish · AutoRuns</span>
      </div>

      {showThread ? (
        <div ref={scrollRef} className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
          {messages.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Ask me to find datasets, sample rows, check AutoRuns, or kick off GPU autoresearch.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={!token || busy}
                    onClick={() => submit(p)}
                    className="rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] px-2 py-1 text-left text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={m.id}
                  className={cn("flex flex-col gap-0.5", isUser ? "items-end" : "items-start")}
                >
                  <span className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {isUser ? "you" : "agent"}
                  </span>
                  <div
                    className={cn(
                      "max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                      isUser
                        ? "bg-primary text-primary-foreground"
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
      ) : null}

      <div className="border-t border-[hsl(var(--border-subtle))] px-4 pt-3">
        <textarea
          value={input}
          onFocus={() => setExpanded(true)}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            token
              ? "Ask Trainfabric agent… (discover, query, publish, start agent)"
              : "Sign in to use Trainfabric agent"
          }
          rows={expanded || input ? 3 : 1}
          disabled={!token}
          className="min-h-[40px] w-full resize-none border-0 bg-transparent px-0 py-1 text-base outline-none focus:ring-0 disabled:opacity-60"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3">
        <div className="flex flex-wrap gap-2">
          <QuickPill href="/datasets" icon={Database}>
            Discover
          </QuickPill>
          <QuickPill href="/new" icon={Plus}>
            Publish
          </QuickPill>
          <QuickPill href="/agents/new" icon={Bot}>
            Start agent
          </QuickPill>
          <QuickPill href="/docs/mcp" icon={BookOpen}>
            MCP
          </QuickPill>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={!token || busy || !input.trim()}
          onClick={() => submit()}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Ask
        </Button>
      </div>
    </section>
  );
}

const EXAMPLE_PROMPTS = [
  "Find datasets about NYC taxi",
  "List my AutoRuns",
  "What can you help with?",
];

function QuickPill({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] px-3 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:bg-[hsl(var(--elevated))] hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Link>
  );
}
