"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bot, ExternalLink, Loader2, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

type AutoDetail = {
  run: {
    id: string;
    datasetId: string;
    status: string;
    error?: string;
    repo: { url: string; defaultBranch: string; lastSyncedSha?: string };
    protocol: {
      snapshotId: string;
      metric: { name: string; direction: string };
      budget: { maxTrials: number; maxWallClockSec: number };
      mutablePaths: string[];
      immutablePaths: string[];
    };
    box: {
      boxId?: string;
      desktopUrl?: string;
      daemonHostUrl?: string;
    };
    compute: { provider: string; modalRef?: string; runnerId?: string };
    progress: {
      trial: number;
      bestScore?: number;
      lastCommitSha?: string;
      updatedAt: number;
    };
  };
  trials: Array<{
    id: string;
    status: string;
    hypothesis?: string;
    commitSha?: string;
    score?: number;
    kept?: boolean;
    error?: string;
    createdAt: number;
  }>;
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
        <Link href="/home" className="mt-4 inline-block text-sm text-primary hover:underline">
          ← Home
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

  const { run, trials, events } = detail;
  const pct = Math.min(
    100,
    Math.round((run.progress.trial / Math.max(run.protocol.budget.maxTrials, 1)) * 100),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">Autoresearch monitor</h1>
          <Badge variant="outline">{run.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          <a href={run.repo.url} className="text-primary hover:underline" target="_blank" rel="noreferrer">
            {run.repo.url}
          </a>{" "}
          · {run.repo.defaultBranch} · dataset{" "}
          <code className="text-xs">{run.datasetId}</code>
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
      </header>

      {run.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {run.error}
        </p>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Trials" value={`${run.progress.trial} / ${run.protocol.budget.maxTrials}`} />
        <Stat
          label={`Best ${run.protocol.metric.name}`}
          value={run.progress.bestScore != null ? String(run.progress.bestScore) : "—"}
        />
        <Stat label="Last SHA" value={run.progress.lastCommitSha?.slice(0, 8) ?? "—"} />
      </section>

      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Protocol</h2>
        <dl className="grid gap-2 rounded-lg border p-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Snapshot</dt>
            <dd className="font-mono">{run.protocol.snapshotId}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Compute</dt>
            <dd>
              {run.compute.provider}
              {run.compute.modalRef ? ` · ${run.compute.modalRef}` : ""}
              {run.compute.runnerId ? ` · ${run.compute.runnerId}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Mutable</dt>
            <dd>{run.protocol.mutablePaths.join(", ")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Immutable</dt>
            <dd>{run.protocol.immutablePaths.join(", ")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Box</dt>
            <dd className="font-mono">{run.box.boxId ?? "—"}</dd>
          </div>
        </dl>
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
                    <td className="px-3 py-2">{t.kept == null ? "—" : t.kept ? "yes" : "no"}</td>
                    <td className="px-3 py-2 font-mono">{t.commitSha?.slice(0, 8) ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {events && events.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Box events</h2>
          <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/20 p-3 text-[11px]">
            {JSON.stringify(events.slice(-20), null, 2)}
          </pre>
        </section>
      ) : null}
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
