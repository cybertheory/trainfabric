"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Bot, Eraser, Loader2, RotateCcw, Send, Sparkles } from "lucide-react";
import { AgentMarkdown } from "@/components/agent-markdown";
import { Button } from "@/components/ui/button";
import { publicApiOrigin } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";
import { cn } from "@/lib/utils";

type TokenGetter = () => Promise<string | null>;

const MAX_INPUT = 800;
const EXAMPLE_PROMPTS = [
  "Find datasets about NYC taxi",
  "List my AutoRuns",
  "What can you help with?",
];

function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Home hero — ephemeral Trainfabric agent shortcut (AI SDK useChat → Worker tool loop).
 * Session is page-local: no history hydrate; Clear resets DO + UI.
 */
export function TrainfabricAgentBox({
  token,
  getToken,
}: {
  token?: string | null;
  getToken?: TokenGetter;
}) {
  const { authToken } = useJobTracker();
  const getTokenRef = useRef<TokenGetter | undefined>(getToken);
  getTokenRef.current = getToken;
  const tokenRef = useRef<string | null>(token ?? authToken ?? null);
  tokenRef.current = token ?? authToken ?? null;

  const origin = publicApiOrigin();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionReady = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${origin}/agent/messages/stream`,
        headers: async (): Promise<Record<string, string>> => {
          const fresh = getTokenRef.current ? await getTokenRef.current() : null;
          const t = fresh ?? tokenRef.current;
          if (fresh) tokenRef.current = fresh;
          return t ? { Authorization: `Bearer ${t}` } : {};
        },
      }),
    [origin],
  );

  const chat = useChat({
    id: "trainfabric-agent-home",
    transport,
    onError: (err) => {
      const msg = err.message || "Agent request failed";
      if (/401|unauthorized|sign in/i.test(msg)) {
        setError("Sign in again to keep chatting.");
      } else if (/gateway|503|not configured/i.test(msg)) {
        setError("Agent is briefly unavailable — try again, or use Discover / Agents.");
      } else {
        setError(msg.length > 160 ? `${msg.slice(0, 160)}…` : msg);
      }
    },
  });
  const { messages, sendMessage, status, setMessages } = chat;
  const stop = "stop" in chat && typeof chat.stop === "function" ? chat.stop : undefined;

  const authed = Boolean(tokenRef.current || getToken);
  const busy = status === "submitted" || status === "streaming";

  /** Fresh DO thread once per page visit so the shortcut stays ephemeral. */
  const ensureFreshSession = useCallback(async () => {
    if (sessionReady.current || !authed) return;
    setBooting(true);
    try {
      const fresh = getTokenRef.current ? await getTokenRef.current() : null;
      const t = fresh ?? tokenRef.current;
      if (!t) return;
      tokenRef.current = t;
      await fetch(`${origin}/agent/sessions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t}` },
      });
      sessionReady.current = true;
      setMessages([]);
    } catch {
      /* still allow asks — server may reuse prior short window */
      sessionReady.current = true;
    } finally {
      setBooting(false);
    }
  }, [authed, origin, setMessages]);

  useEffect(() => {
    if (open && authed) void ensureFreshSession();
  }, [open, authed, ensureFreshSession]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, error, busy]);

  async function bearer(): Promise<string | null> {
    const fresh = getTokenRef.current ? await getTokenRef.current() : null;
    const t = fresh ?? tokenRef.current;
    if (t) tokenRef.current = t;
    return t;
  }

  async function submit(textOverride?: string) {
    const text = (textOverride ?? input).trim().slice(0, MAX_INPUT);
    if (!text || busy || booting) return;
    const t = await bearer();
    if (!t) {
      setError("Sign in to use the quick agent.");
      return;
    }
    setError(null);
    setOpen(true);
    setLastPrompt(text);
    setInput("");
    await ensureFreshSession();
    try {
      await sendMessage({ text });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send");
    }
  }

  async function clearThread() {
    stop?.();
    setError(null);
    setLastPrompt(null);
    setMessages([]);
    sessionReady.current = false;
    const t = await bearer();
    if (t) {
      try {
        await fetch(`${origin}/agent/sessions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${t}` },
        });
        sessionReady.current = true;
      } catch {
        /* ignore */
      }
    }
  }

  const showThread = open || messages.length > 0 || Boolean(error);

  return (
    <section className="tf-elevated overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">Quick agent</span>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              ephemeral · home shortcut
            </span>
          </div>
          {!showThread ? (
            <p className="truncate text-[11px] text-muted-foreground">
              Ask anything — discover data, check AutoRuns, start an agent
            </p>
          ) : null}
        </div>
        {showThread ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
            disabled={busy || booting}
            onClick={() => void clearThread()}
          >
            <Eraser className="h-3 w-3" />
            Clear
          </Button>
        ) : null}
      </div>

      {showThread ? (
        <div
          ref={scrollRef}
          className="max-h-64 space-y-2.5 overflow-y-auto border-t border-[hsl(var(--border-subtle))] px-4 py-3 sm:max-h-80"
        >
          {messages.length === 0 && !error && !busy ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Fresh chat each visit. Try one of these:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={!authed || busy || booting}
                    onClick={() => void submit(p)}
                    className="rounded-full border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] px-2.5 py-1 text-left text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const isUser = m.role === "user";
              const text = messageText(m);
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
                      "max-w-[92%] rounded-xl px-3 py-2",
                      isUser
                        ? "bg-primary text-primary-foreground"
                        : "border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] text-foreground",
                    )}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap text-sm">{text}</p>
                    ) : text ? (
                      <AgentMarkdown text={text} />
                    ) : busy ? (
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Working…
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}

          {busy && messages.length > 0 && messages[messages.length - 1]?.role === "user" ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Looking things up…
            </div>
          ) : null}

          {error ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span className="flex-1">{error}</span>
              {lastPrompt ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium hover:bg-destructive/10"
                  onClick={() => {
                    setError(null);
                    void submit(lastPrompt);
                  }}
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          "flex items-end gap-2 px-3 pb-3",
          showThread && "border-t border-[hsl(var(--border-subtle))] pt-3",
        )}
      >
        <div className="min-w-0 flex-1 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] px-3 py-2 focus-within:border-primary/40">
          <textarea
            value={input}
            onFocus={() => setOpen(true)}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={
              authed ? "Ask a quick question…" : "Sign in to use the quick agent"
            }
            rows={open || input ? 2 : 1}
            disabled={!authed || booting}
            className="min-h-[28px] w-full resize-none border-0 bg-transparent px-0 py-0.5 text-sm outline-none focus:ring-0 disabled:opacity-60"
          />
          {!authed ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              <Link href="/sign-in" className="text-primary hover:underline">
                Sign in
              </Link>{" "}
              for discover, query, and AutoRun shortcuts.
            </p>
          ) : (
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Bot className="h-3 w-3" />
                Uses your datasets & agents
              </span>
              <span>
                {input.length}/{MAX_INPUT}
              </span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {busy ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 px-3"
              onClick={() => stop?.()}
            >
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-9 px-3"
              disabled={!authed || booting || !input.trim()}
              onClick={() => void submit()}
            >
              {booting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Ask
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
