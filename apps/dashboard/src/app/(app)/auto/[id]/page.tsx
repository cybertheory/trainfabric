"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Bot,
  ChevronDown,
  ChevronRight,
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
  updatedAt?: number;
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

function providerLabel(provider: string, runnerId?: string): string {
  if (provider === "trainfabric_gpu" || provider === "modal") return "trainfabric_gpu";
  if (provider === "runner") return runnerId ? `runner · ${runnerId.slice(0, 10)}` : "runner";
  return provider;
}

function normalizeProvider(provider: string): string {
  return provider === "modal" ? "trainfabric_gpu" : provider;
}

function commitUrl(repoUrl: string, sha?: string): string | null {
  if (!sha) return null;
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2].replace(/\.git$/, "")}/commit/${sha}`;
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

function jobStatusClass(status: string): string {
  if (status === "running" || status === "claimed") return "border-primary/40 text-primary";
  if (status === "done") return "border-emerald-500/40 text-emerald-700 dark:text-emerald-300";
  if (status === "error" || status === "cancelled") return "border-destructive/40 text-destructive";
  return "";
}

export default function AutoRunMonitorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<AutoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusFlash, setStatusFlash] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [activityLimit, setActivityLimit] = useState(12);
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
  const activitySorted = [...activity].sort((a, b) => b.createdAt - a.createdAt);
  const activityShown = activitySorted.slice(0, activityLimit);

  return (
    <div className="mx-auto flex max-w-[90rem] flex-col gap-4 pb-8">
      <AutoRunHeader
        run={run}
        bound={bound}
        busy={busy}
        statusFlash={statusFlash}
        goalOpen={goalOpen}
        onToggleGoal={() => setGoalOpen((v) => !v)}
        onAction={action}
      />

      {/* Mobile: Run above Steer. Desktop: Steer | Run */}
      <div className="grid min-h-[calc(100vh-12rem)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-stretch">
        {/* Steer */}
        <section className="order-2 flex min-h-[28rem] flex-col overflow-hidden tf-elevated lg:order-1 lg:sticky lg:top-4 lg:max-h-[calc(100vh-8rem)]">
          <div className="flex items-center gap-2 border-b border-[hsl(var(--border-subtle))] px-4 py-2.5">
            <MessageSquare className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Steer</h2>
            <span className="text-[11px] text-muted-foreground">
              MCP <code className="text-[10px]">message_auto_agent</code>
            </span>
          </div>
          <div className="min-h-0 flex-1 p-2 sm:p-3">
            <AutoChatPanel autoRunId={id} />
          </div>
        </section>

        {/* Run workspace */}
        <div className="order-1 flex min-h-0 flex-col gap-4 lg:order-2">
          <AutoRunNow
            nowText={nowText}
            pct={pct}
            trial={run.progress.trial}
            maxTrials={run.protocol.budget.maxTrials}
            bestScore={run.progress.bestScore}
            metricName={run.protocol.metric.name}
            metricDirection={run.protocol.metric.direction}
            trials={trials}
            statusFlash={statusFlash}
          />

          <GpuJobsPanel
            trials={trials}
            provider={run.compute.provider}
            runnerId={run.compute.runnerId}
            repoUrl={run.repo.url}
            bestScore={run.progress.bestScore}
            metricName={run.protocol.metric.name}
          />

          <section className="tf-elevated p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Activity
              </p>
              <span className="text-[11px] text-muted-foreground">{activitySorted.length} events</span>
            </div>
            <ol className="mt-3 max-h-56 space-y-2 overflow-y-auto">
              {activityShown.length === 0 ? (
                <li className="text-xs text-muted-foreground">No activity yet.</li>
              ) : (
                activityShown.map((a) => (
                  <li key={a.id} className="text-xs leading-relaxed">
                    <span className="text-muted-foreground">
                      {new Date(a.createdAt).toLocaleTimeString()}
                    </span>{" "}
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {a.kind}
                    </span>{" "}
                    {a.message}
                  </li>
                ))
              )}
            </ol>
            {activitySorted.length > activityLimit ? (
              <button
                type="button"
                className="mt-3 text-xs text-primary hover:underline"
                onClick={() => setActivityLimit((n) => n + 20)}
              >
                Show more
              </button>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function AutoRunHeader({
  run,
  bound,
  busy,
  statusFlash,
  goalOpen,
  onToggleGoal,
  onAction,
}: {
  run: AutoDetail["run"];
  bound: string[];
  busy: boolean;
  statusFlash: boolean;
  goalOpen: boolean;
  onToggleGoal: () => void;
  onAction: (path: "pause" | "resume" | "cancel") => void;
}) {
  return (
    <header className="tf-elevated space-y-3 px-4 py-3 sm:px-5">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        ← Agents
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="h-5 w-5 shrink-0 text-primary" />
            <h1 className="font-display text-xl font-semibold tracking-tight">
              {repoLabel(run.repo.url)}
            </h1>
            <Badge
              variant="outline"
              className={cn(
                "transition-colors duration-500",
                statusFlash && "border-primary text-primary",
              )}
            >
              {run.status.replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {providerLabel(run.compute.provider, run.compute.runnerId)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            <a
              href={run.repo.url}
              className="text-primary hover:underline"
              target="_blank"
              rel="noreferrer"
            >
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
        </div>

        <div className="flex flex-wrap gap-2">
          {run.status === "running" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void onAction("pause")}
            >
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          ) : null}
          {run.status === "paused" ? (
            <Button type="button" size="sm" disabled={busy} onClick={() => void onAction("resume")}>
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
              onClick={() => void onAction("cancel")}
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
              Box
            </a>
          ) : null}
        </div>
      </div>

      {run.goal?.trim() ? (
        <div className="border-t border-[hsl(var(--border-subtle))] pt-2">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
            onClick={onToggleGoal}
          >
            {goalOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Goal
          </button>
          {goalOpen ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{run.goal.trim()}</p>
          ) : (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{run.goal.trim()}</p>
          )}
        </div>
      ) : null}
    </header>
  );
}

function AutoRunNow({
  nowText,
  pct,
  trial,
  maxTrials,
  bestScore,
  metricName,
  metricDirection,
  trials,
  statusFlash,
}: {
  nowText: string;
  pct: number;
  trial: number;
  maxTrials: number;
  bestScore?: number;
  metricName: string;
  metricDirection: string;
  trials: Trial[];
  statusFlash: boolean;
}) {
  return (
    <section
      className={cn(
        "tf-elevated px-4 py-4 transition-shadow duration-500 sm:px-5",
        statusFlash && "shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Now
        </p>
        <span className="text-[11px] text-muted-foreground">Run</span>
      </div>
      <p className="mt-2 text-base leading-relaxed text-foreground">{nowText}</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--inset))]">
        <div
          className="h-full bg-primary transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Trial {trial} / {maxTrials}
        {bestScore != null ? ` · best ${metricName} ${bestScore}` : ""}
      </p>
      <div className="mt-3">
        <Sparkline trials={trials} direction={metricDirection} />
      </div>
    </section>
  );
}

function GpuJobsPanel({
  trials,
  provider,
  runnerId,
  repoUrl,
  bestScore,
  metricName,
}: {
  trials: Trial[];
  provider: string;
  runnerId?: string;
  repoUrl: string;
  bestScore?: number;
  metricName: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const prevStatusesRef = useRef<Record<string, string>>({});
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  const prov = normalizeProvider(provider);
  const running = trials.filter((t) => t.status === "running" || t.status === "claimed").length;
  const done = trials.filter((t) => t.status === "done").length;

  useEffect(() => {
    const nextFlash = new Set<string>();
    for (const t of trials) {
      const prev = prevStatusesRef.current[t.id];
      if (prev && prev !== t.status) nextFlash.add(t.id);
      prevStatusesRef.current[t.id] = t.status;
    }
    if (nextFlash.size === 0) return;
    setFlashIds(nextFlash);
    const timer = window.setTimeout(() => setFlashIds(new Set()), 700);
    return () => window.clearTimeout(timer);
  }, [trials]);

  const sorted = useMemo(
    () => [...trials].sort((a, b) => b.createdAt - a.createdAt),
    [trials],
  );

  return (
    <section className="tf-elevated overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--border-subtle))] px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            GPU jobs
          </p>
          <Badge variant="outline" className="font-mono text-[10px]">
            {providerLabel(provider, runnerId)}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {running} running · {done} done
          {bestScore != null ? ` · best ${metricName} ${bestScore}` : ""}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-xs">
          <thead className="border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Kept</th>
              <th className="px-3 py-2 font-medium">Commit</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  No GPU jobs yet — agent will enqueue after mutate.
                </td>
              </tr>
            ) : (
              sorted.map((t) => {
                const open = expanded === t.id;
                const href = commitUrl(repoUrl, t.commitSha);
                const canExpand = Boolean(t.hypothesis?.trim() || t.error?.trim());
                return (
                  <Fragment key={t.id}>
                    <tr
                      className={cn(
                        "border-b border-[hsl(var(--border-subtle))] last:border-0 transition-colors duration-500",
                        flashIds.has(t.id) && "bg-primary/5",
                        canExpand && "cursor-pointer hover:bg-[hsl(var(--surface))]",
                      )}
                      onClick={() => {
                        if (!canExpand) return;
                        setExpanded((cur) => (cur === t.id ? null : t.id));
                      }}
                    >
                      <td className="px-3 py-2 font-mono">
                        <span className="inline-flex items-center gap-1">
                          {canExpand ? (
                            open ? (
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            )
                          ) : (
                            <span className="inline-block w-3" />
                          )}
                          {t.id.replace(/^trial_/, "").slice(0, 10)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] transition-colors duration-500",
                            jobStatusClass(t.status),
                            flashIds.has(t.id) && "border-primary text-primary",
                          )}
                        >
                          {t.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        {prov}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{t.score ?? "—"}</td>
                      <td className="px-3 py-2">
                        {t.kept == null ? "—" : t.kept ? "yes" : "no"}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {t.commitSha ? (
                          href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {t.commitSha.slice(0, 8)}
                            </a>
                          ) : (
                            t.commitSha.slice(0, 8)
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                    {open ? (
                      <tr className="border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--inset))] last:border-0">
                        <td colSpan={6} className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                          {t.hypothesis?.trim() ? (
                            <p>
                              <span className="font-medium text-foreground">Hypothesis · </span>
                              {t.hypothesis.trim()}
                            </p>
                          ) : null}
                          {t.error?.trim() ? (
                            <p className={cn(t.hypothesis?.trim() && "mt-2", "text-destructive")}>
                              <span className="font-medium">Error · </span>
                              {t.error.trim()}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
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
