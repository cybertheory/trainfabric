"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bot, ExternalLink, Loader2, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import type { DatasetMeta } from "@trainfabric/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
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
  events?: unknown[];
};

export default function AutoRunMonitorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<AutoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const out = await apiFetch<AutoDetail>(`/auto/${id}`);
      setDetail(out);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id]);

  useEffect(() => {
    void load();
    const iv = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(iv);
  }, [load]);

  async function action(path: "pause" | "resume" | "cancel") {
    setBusy(true);
    try {
      await apiFetch(`/auto/${id}/${path}`, { method: "POST" });
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
      <div className="mx-auto max-w-3xl px-4 py-16">
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
  const pct = Math.min(
    100,
    Math.round((run.progress.trial / Math.max(run.protocol.budget.maxTrials, 1)) * 100),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <Link
          href="/agents"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          ← Agents
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">
            {run.repo.url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "") ||
              "Autoresearch monitor"}
          </h1>
          <Badge variant="outline">{run.status.replace("_", " ")}</Badge>
        </div>
        {run.goal?.trim() ? (
          <p className="text-sm text-foreground/90">{run.goal.trim().slice(0, 280)}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Loading research brief from the connected repo…
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          <a
            href={run.repo.url}
            className="text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            {run.repo.url.replace(/^https?:\/\/(www\.)?github\.com\//, "")}
          </a>{" "}
          · {run.repo.defaultBranch} ·{" "}
          {bound.length ? (
            <>data <code className="text-xs">{bound.join(", ")}</code></>
          ) : (
            <span className="text-amber-600">choosing dataset from repo brief…</span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || run.status !== "running"}
            onClick={() => void action("pause")}
          >
            <Pause className="h-3.5 w-3.5" />
            Pause
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || run.status !== "paused"}
            onClick={() => void action("resume")}
          >
            <Play className="h-3.5 w-3.5" />
            Resume
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy || run.status === "done" || run.status === "cancelled"}
            onClick={() => void action("cancel")}
          >
            <Square className="h-3.5 w-3.5" />
            Cancel
          </Button>
          {run.box.desktopUrl ? (
            <a
              href={run.box.desktopUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Box desktop
            </a>
          ) : null}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </header>

      {run.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {run.error}
        </p>
      ) : null}

      {run.status === "awaiting_user" ? (
        <BindPanel autoRunId={id} goal={run.goal} onBound={() => void load()} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-3">
            <Stat label="Trials" value={`${run.progress.trial} / ${run.protocol.budget.maxTrials}`} />
            <Stat
              label={`Best ${run.protocol.metric.name}`}
              value={run.progress.bestScore != null ? String(run.progress.bestScore) : "—"}
            />
            <Stat label="Last SHA" value={run.progress.lastCommitSha?.slice(0, 8) ?? "—"} />
          </section>

          <Sparkline trials={trials} direction={run.protocol.metric.direction} />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Protocol</h2>
            <dl className="grid gap-2 rounded-lg border p-3 text-xs sm:grid-cols-2">
              <Field k="Snapshot" v={run.protocol.snapshotId || "(bound on dataset select)"} mono />
              <Field
                k="Compute"
                v={`${run.compute.provider}${run.compute.modalRef ? ` · ${run.compute.modalRef}` : ""}${
                  run.compute.runnerId ? ` · ${run.compute.runnerId}` : ""
                }`}
              />
              <Field k="Mutable" v={run.protocol.mutablePaths.join(", ")} />
              <Field k="Immutable" v={run.protocol.immutablePaths.join(", ")} />
              <Field k="Box" v={run.box.boxId ?? "—"} mono />
            </dl>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Activity</h2>
            <ol className="space-y-2 rounded-lg border p-3">
              {activity.length === 0 ? (
                <li className="text-xs text-muted-foreground">No activity yet.</li>
              ) : (
                [...activity].reverse().map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-xs">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                    <div className="min-w-0">
                      <p className="truncate">
                        <span className="text-muted-foreground">[{a.kind}]</span> {a.message}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(a.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </li>
                ))
              )}
            </ol>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Trials</h2>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Id</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Score</th>
                    <th className="px-3 py-2 font-medium">Kept</th>
                    <th className="px-3 py-2 font-medium">SHA</th>
                  </tr>
                </thead>
                <tbody>
                  {trials.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-muted-foreground">
                        Waiting for trials…
                      </td>
                    </tr>
                  ) : (
                    trials.map((t) => (
                      <tr key={t.id} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 font-mono">{t.id.slice(0, 14)}</td>
                        <td className="px-3 py-2">{t.status}</td>
                        <td className="px-3 py-2">{t.score ?? "—"}</td>
                        <td className="px-3 py-2">
                          {t.kept == null ? "—" : t.kept ? "yes" : "no"}
                        </td>
                        <td className="px-3 py-2 font-mono">{t.commitSha?.slice(0, 8) ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <AutoChatPanel autoRunId={id} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-medium">{value}</p>
    </div>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={mono ? "font-mono" : undefined}>{v}</dd>
    </div>
  );
}

/** SVG-only sparkline of trial scores (best-so-far envelope highlighted). */
function Sparkline({ trials, direction }: { trials: Trial[]; direction: string }) {
  const points = useMemo(
    () =>
      trials
        .filter((t) => typeof t.score === "number")
        .map((t) => t.score as number),
    [trials],
  );
  if (points.length < 2) {
    return (
      <div className="rounded-lg border px-3 py-6 text-center text-xs text-muted-foreground">
        Score trend appears once trials report back.
      </div>
    );
  }
  const w = 600;
  const h = 96;
  const pad = 6;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (points.length - 1);
  const y = (v: number) => pad + (h - 2 * pad) * (1 - (v - min) / range);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const best = direction === "min" ? min : max;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">
        Score trend <span className="text-xs font-normal text-muted-foreground">({direction})</span>
      </h2>
      <div className="rounded-lg border p-2">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full" preserveAspectRatio="none">
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
          {points.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={2.5} className="fill-primary" />
          ))}
        </svg>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {points.length} scored trials · best {best}
        </p>
      </div>
    </section>
  );
}

/** Awaiting-dataset confirm: let the user bind a dataset the agent should use. */
function BindPanel({
  autoRunId,
  goal,
  onBound,
}: {
  autoRunId: string;
  goal?: string;
  onBound: () => void;
}) {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [binding, setBinding] = useState(false);

  useEffect(() => {
    apiFetch<{ datasets: DatasetMeta[] }>(
      `/datasets${goal ? `?search=${encodeURIComponent(goal)}` : ""}`,
    )
      .then((r) => setDatasets(r.datasets ?? []))
      .catch(() => setDatasets([]));
  }, [goal]);

  async function bind() {
    if (!datasetId) return;
    setBinding(true);
    try {
      await apiFetch(`/auto/${autoRunId}/bind-dataset`, {
        method: "POST",
        body: JSON.stringify({ datasetId, reason: "Confirmed by user in monitor" }),
      });
      toast.success("Dataset bound — agent resuming");
      onBound();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bind failed");
    } finally {
      setBinding(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-sm font-medium">Agent needs a dataset</p>
      <p className="text-xs text-muted-foreground">
        No clear discovery match{goal ? ` for the repo brief` : ""}. Pick a dataset to bind — or tell the
        agent which one to use in chat.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={cn(
            "h-9 min-w-[240px] flex-1 rounded-md border border-input bg-background px-2 text-sm",
          )}
          value={datasetId}
          onChange={(e) => setDatasetId(e.target.value)}
        >
          <option value="">Select a dataset…</option>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.owner}/{d.name}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" disabled={!datasetId || binding} onClick={() => void bind()}>
          {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Bind dataset
        </Button>
      </div>
    </div>
  );
}
