"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Cpu, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";
import { cn } from "@/lib/utils";

type GpuJobRow = {
  id: string;
  autoRunId: string;
  status: string;
  score?: number;
  kept?: boolean;
  commitSha?: string;
  error?: string;
  provider: string;
  runnerId?: string;
  repo: string;
  repoUrl: string;
  metric?: string;
  createdAt: number;
  updatedAt: number;
};

function providerLabel(provider: string, runnerId?: string): string {
  if (provider === "trainfabric_gpu" || provider === "modal") return "Trainfabric GPU";
  if (provider === "runner") return runnerId ? `Runner · ${runnerId.slice(0, 12)}` : "Self-hosted runner";
  return provider;
}

function statusClass(status: string): string {
  if (status === "running" || status === "claimed") return "border-primary/40 text-primary";
  if (status === "done") return "border-emerald-500/40 text-emerald-700 dark:text-emerald-300";
  if (status === "error" || status === "cancelled") return "border-destructive/40 text-destructive";
  return "";
}

export default function GpuRunsPage() {
  const { authToken, authReady } = useJobTracker();
  const [jobs, setJobs] = useState<GpuJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<"all" | "trainfabric_gpu" | "runner">("all");
  const [status, setStatus] = useState<"all" | "pending" | "running" | "done" | "error">("all");

  useEffect(() => {
    if (!authReady) return;

    if (!authToken) {
      setLoading(false);
      setJobs([]);
      setError("Sign in required to list GPU jobs.");
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const q = new URLSearchParams();
        if (provider !== "all") q.set("provider", provider);
        if (status !== "all") q.set("status", status);
        const qs = q.toString();
        try {
          const r = await apiFetch<{ jobs: GpuJobRow[] }>(`/gpu/jobs${qs ? `?${qs}` : ""}`, {
            token: authToken,
          });
          if (!cancelled) {
            setJobs(r.jobs ?? []);
            setError(null);
          }
          return;
        } catch {
          /* Fallback until /gpu/jobs is deployed: aggregate from AutoRuns. */
        }
        const list = await apiFetch<{ runs: Array<{
          id: string;
          compute: { provider: string; runnerId?: string };
          repo: { url: string; fullName?: string };
          protocol: { metric: { name: string } };
        }> }>("/auto", { token: authToken });
        const runs = list.runs ?? [];
        const details = await Promise.all(
          runs.slice(0, 40).map((run) =>
            apiFetch<{
              run: (typeof runs)[number];
              trials: Array<{
                id: string;
                status: string;
                score?: number;
                kept?: boolean;
                commitSha?: string;
                error?: string;
                createdAt: number;
                updatedAt: number;
              }>;
            }>(`/auto/${run.id}`, { token: authToken }).catch(() => null),
          ),
        );
        let rows: GpuJobRow[] = [];
        for (const d of details) {
          if (!d) continue;
          const run = d.run;
          const prov =
            run.compute.provider === "modal" ? "trainfabric_gpu" : run.compute.provider;
          const repo =
            run.repo.fullName ||
            run.repo.url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
          for (const t of d.trials ?? []) {
            rows.push({
              id: t.id,
              autoRunId: run.id,
              status: t.status,
              score: t.score,
              kept: t.kept,
              commitSha: t.commitSha,
              error: t.error,
              provider: prov,
              runnerId: run.compute.runnerId,
              repo,
              repoUrl: run.repo.url,
              metric: run.protocol.metric.name,
              createdAt: t.createdAt,
              updatedAt: t.updatedAt,
            });
          }
        }
        if (provider !== "all") {
          rows = rows.filter((j) => j.provider === provider);
        }
        if (status !== "all") {
          rows = rows.filter((j) => j.status === status);
        }
        rows.sort((a, b) => b.createdAt - a.createdAt);
        if (!cancelled) {
          setJobs(rows);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load GPU jobs");
          setJobs([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [authToken, authReady, provider, status]);

  const counts = useMemo(() => {
    const running = jobs.filter((j) => j.status === "running" || j.status === "claimed" || j.status === "pending")
      .length;
    const done = jobs.filter((j) => j.status === "done").length;
    return { running, done, total: jobs.length };
  }, [jobs]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-1 py-2">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">GPU runs</h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every GPU job submitted by your agents — managed Trainfabric GPU and self-hosted HTTP
          runners.
        </p>
        <p className="text-xs text-muted-foreground">
          {counts.total} jobs · {counts.running} active · {counts.done} done
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={provider}
          onChange={(e) => setProvider(e.target.value as typeof provider)}
          aria-label="Filter by provider"
        >
          <option value="all">All providers</option>
          <option value="trainfabric_gpu">Trainfabric GPU</option>
          <option value="runner">Self-hosted runner</option>
        </select>
        <select
          className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="done">Done</option>
          <option value="error">Error</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive">
          {error}
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-14 text-center">
          <Cpu className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-base font-medium">No GPU jobs yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            When an agent enqueues a trial, it shows up here with provider, score, and commit.
          </p>
          <Button asChild className="mt-5" size="sm">
            <Link href="/agents">View agent runs</Link>
          </Button>
        </div>
      ) : (
        <div className="tf-inset overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">Job</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Provider</th>
                <th className="px-3 py-2.5 font-medium">Score</th>
                <th className="px-3 py-2.5 font-medium">Kept</th>
                <th className="px-3 py-2.5 font-medium">Repo</th>
                <th className="px-3 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr
                  key={j.id}
                  className="border-b border-[hsl(var(--border-subtle))] last:border-0"
                >
                  <td className="px-3 py-2.5 font-mono text-xs">{j.id.slice(0, 14)}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className={cn("text-[10px]", statusClass(j.status))}>
                      {j.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {providerLabel(j.provider, j.runnerId)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {j.score != null ? j.score : "—"}
                    {j.metric ? (
                      <span className="ml-1 text-[10px] text-muted-foreground">{j.metric}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {j.kept == null ? "—" : j.kept ? "yes" : "no"}
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-2.5 text-xs">
                    <a
                      href={j.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {j.repo}
                    </a>
                    {j.commitSha ? (
                      <span className="ml-1 font-mono text-muted-foreground">
                        @{j.commitSha.slice(0, 7)}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                    {new Date(j.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                      <Link href={`/auto/${j.autoRunId}`}>Open run</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
