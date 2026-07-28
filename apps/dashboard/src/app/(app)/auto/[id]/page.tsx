"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";
import { AutoChatPanel } from "@/components/auto-chat-panel";
import { cn } from "@/lib/utils";

type Activity = {
  id: string;
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
  createdAt: number;
};

type Trial = {
  id: string;
  status: string;
  hypothesis?: string;
  commitSha?: string;
  score?: number;
  kept?: boolean;
  error?: string;
  createdAt: number;
};

type AutoDetail = {
  run: {
    id: string;
    datasetId?: string;
    boundDatasets?: string[];
    goal?: string;
    status: string;
    error?: string;
    repo: { url: string; defaultBranch: string; lastSyncedSha?: string };
    protocol: {
      snapshotId?: string;
      metric: { name: string; direction: string };
      budget: { maxTrials: number; maxWallClockSec: number };
      mutablePaths: string[];
      immutablePaths: string[];
    };
    box: { boxId?: string; desktopUrl?: string; daemonHostUrl?: string };
    compute: { provider: string; modalRef?: string; runnerId?: string };
    progress: { trial: number; bestScore?: number; lastCommitSha?: string; updatedAt: number };
  };
  trials: Trial[];
  activity?: Activity[];
  boundDatasets?: string[];
};

function repoLabel(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "") || url;
}

function statusSentence(run: AutoDetail["run"], latest?: Activity): string {
  if (run.error) return run.error;
  if (latest?.message) return latest.message;
  switch (run.status) {
    case "provisioning":
      return "Provisioning the sandbox and cloning the repo…";
    case "running":
      return run.datasetId
        ? `Running trial ${run.progress.trial} of ${run.protocol.budget.maxTrials}.`
        : "Cloned — discovering a dataset from the repo brief…";
    case "paused":
      return "Paused. Resume when you’re ready to continue trials.";
    case "awaiting_user":
      return "Paused — reply in Steer chat (or MCP/CLI) so the agent can continue.";
    case "done":
      return "Run finished.";
    case "cancelled":
      return "Run cancelled.";
    case "error":
      return "Run hit an error.";
    default:
      return `Status: ${run.status.replace(/_/g, " ")}.`;
  }
}

export default function AutoRunMonitorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<AutoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [statusFlash, setStatusFlash] = useState(false);
  const prevStatusRef = useRef<string | null>(null);
  const { authToken } = useJobTracker();

  const load = useCallback(async () => {
    try {
      const out = await apiFetch<AutoDetail>(`/auto/${id}`, { token: authToken });
      setDetail(out);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id, authToken]);

  useEffect(() => {
    void load();
    const iv = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const status = detail?.run.status;
    if (!status) return;
    if (prevStatusRef.current && prevStatusRef.current !== status) {
      setStatusFlash(true);
      const t = window.setTimeout(() => setStatusFlash(false), 700);
      prevStatusRef.current = status;
      return () => window.clearTimeout(t);
    }
    prevStatusRef.current = status;
  }, [detail?.run.status]);

  async function action(path: "pause" | "resume" | "cancel") {
    setBusy(true);
    try {
      await apiFetch(`/auto/${id}/${path}`, { method: "POST", token: authToken });
      toast.success(`AutoRun ${path}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <p className="text-sm text-destructive">{error}</p>
        <Link href="/agents" className="mt-4 inline-block text-sm text-primary hover:underline">
          ← Agents
        </Link>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const { run, trials, activity = [] } = detail;
  const bound = run.boundDatasets ?? (run.datasetId ? [run.datasetId] : []);
  const latest = [...activity].sort((a, b) => b.createdAt - a.createdAt)[0];
  const nowText = statusSentence(run, latest);
  const pct = Math.min(
    100,
    Math.round((run.progress.trial / Math.max(run.protocol.budget.maxTrials, 1)) * 100),
  );

  const evidenceBody = (
    <div className="space-y-4">
      <Sparkline trials={trials} direction={run.protocol.metric.direction} />
      <ol className="tf-inset max-h-48 space-y-2 overflow-y-auto p-3">
        {activity.length === 0 ? (
          <li className="text-xs text-muted-foreground">No activity yet.</li>
        ) : (
          [...activity].reverse().map((a) => (
            <li key={a.id} className="text-xs">
              <span className="text-muted-foreground">
                {new Date(a.createdAt).toLocaleTimeString()}
              </span>{" "}
              {a.message}
            </li>
          ))
        )}
      </ol>
      <div className="tf-inset overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Kept</th>
              <th className="px-3 py-2 font-medium">SHA</th>
            </tr>
          </thead>
          <tbody>
            {trials.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-muted-foreground">
                  Waiting for trials…
                </td>
              </tr>
            ) : (
              trials.map((t) => (
                <tr key={t.id} className="border-b border-[hsl(var(--border-subtle))] last:border-0">
                  <td className="px-3 py-2">{t.status}</td>
                  <td className="px-3 py-2">{t.score ?? "—"}</td>
                  <td className="px-3 py-2">{t.kept == null ? "—" : t.kept ? "yes" : "no"}</td>
                  <td className="px-3 py-2 font-mono">{t.commitSha?.slice(0, 8) ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="space-y-2">
        <Link
          href="/agents"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          ← Agents
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="font-display text-xl font-semibold tracking-tight">{repoLabel(run.repo.url)}</h1>
          <Badge
            variant="outline"
            className={cn("transition-colors duration-500", statusFlash && "border-primary text-primary")}
          >
            {run.status.replace(/_/g, " ")}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          <a href={run.repo.url} className="text-primary hover:underline" target="_blank" rel="noreferrer">
            {repoLabel(run.repo.url)}
          </a>{" "}
          · {run.repo.defaultBranch}
          {bound.length ? (
            <>
              {" "}
              · data <code className="text-[11px]">{bound.join(", ")}</code>
            </>
          ) : null}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,18rem)] lg:items-start">
        {/* Left context */}
        <aside className="tf-card order-2 space-y-4 p-4 lg:order-1">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Next
            </p>
            {run.status === "awaiting_user" ? (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                The agent paused and is waiting on your reply in Steer — name a dataset id (
                <code className="text-[10px]">ds_…</code>), confirm a candidate, or ask it to search
                again. Same path as MCP <code className="text-[10px]">message_auto_agent</code> /{" "}
                <code className="text-[10px]">bind_auto_dataset</code>.
              </p>
            ) : null}
            {run.status === "provisioning" || (run.status === "running" && !run.datasetId) ? (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Nothing for you to do — the agent is discovering a dataset from the repo brief. Steer
                in chat only if you want to nudge the choice.
              </p>
            ) : null}
            {run.status !== "awaiting_user" &&
            run.status !== "provisioning" &&
            !(run.status === "running" && !run.datasetId) ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Use controls below or steer in chat.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {run.status === "running" ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void action("pause")}>
                <Pause className="h-3.5 w-3.5" />
                Pause
              </Button>
            ) : null}
            {run.status === "paused" ? (
              <Button type="button" size="sm" disabled={busy} onClick={() => void action("resume")}>
                <Play className="h-3.5 w-3.5" />
                Resume
              </Button>
            ) : null}
            {run.status !== "done" && run.status !== "cancelled" ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => void action("cancel")}
              >
                <Square className="h-3.5 w-3.5" />
                Cancel
              </Button>
            ) : null}
            {run.box.desktopUrl ? (
              <a
                href={run.box.desktopUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[hsl(var(--border-strong))] bg-[hsl(var(--elevated))] px-3 text-xs hover:bg-[hsl(var(--surface-2))]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Desktop
              </a>
            ) : null}
          </div>
          {run.goal?.trim() ? (
            <div className="border-t border-[hsl(var(--border-subtle))] pt-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Goal
              </p>
              <p className="mt-2 line-clamp-6 text-xs leading-relaxed text-muted-foreground">
                {run.goal.trim()}
              </p>
            </div>
          ) : null}
        </aside>

        {/* Center hub: Now + Steer */}
        <div className="order-1 space-y-4 lg:order-2">
          <section
            className={cn(
              "tf-elevated px-4 py-4 transition-shadow duration-500 sm:px-5",
              statusFlash && "shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]",
            )}
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Now
            </p>
            <p className="mt-2 text-base leading-relaxed text-foreground">{nowText}</p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--inset))]">
              <div
                className="h-full bg-primary transition-all duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Trial {run.progress.trial} / {run.protocol.budget.maxTrials}
              {run.progress.bestScore != null
                ? ` · best ${run.protocol.metric.name} ${run.progress.bestScore}`
                : ""}
            </p>
          </section>

          <section className="tf-elevated space-y-3 p-3 sm:p-4">
            <div className="flex items-center gap-2 px-1">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Steer</h2>
              <span className="text-[11px] text-muted-foreground">
                MCP <code className="text-[10px]">message_auto_agent</code>
              </span>
            </div>
            <AutoChatPanel autoRunId={id} />
          </section>
        </div>

        {/* Right Evidence rail (desktop); accordion on mobile */}
        <aside className="tf-card order-3 hidden p-4 lg:block">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Evidence
          </p>
          <div className="mt-3">{evidenceBody}</div>
        </aside>

        <section className="tf-card order-4 space-y-3 p-4 lg:hidden">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left text-sm font-medium"
            onClick={() => setShowEvidence((v) => !v)}
          >
            <span>Evidence · trials & activity</span>
            {showEvidence ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showEvidence ? evidenceBody : null}
        </section>
      </div>
    </div>
  );
}

function Sparkline({ trials, direction }: { trials: Trial[]; direction: string }) {
  const points = useMemo(
    () => trials.filter((t) => typeof t.score === "number").map((t) => t.score as number),
    [trials],
  );
  if (points.length < 2) {
    return (
      <div className="tf-inset px-3 py-4 text-center text-xs text-muted-foreground">
        Score trend appears once trials report back.
      </div>
    );
  }
  const w = 600;
  const h = 80;
  const pad = 6;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (points.length - 1);
  const y = (v: number) => pad + (h - 2 * pad) * (1 - (v - min) / range);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const best = direction === "min" ? min : max;
  return (
    <div className="tf-inset p-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" preserveAspectRatio="none">
        <line
          x1={pad}
          x2={w - pad}
          y1={y(best)}
          y2={y(best)}
          className="stroke-primary/30"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
        <path d={path} fill="none" className="stroke-primary" strokeWidth={2} />
      </svg>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {points.length} scored · best {best} ({direction})
      </p>
    </div>
  );
}
