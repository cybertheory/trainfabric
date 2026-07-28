"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Loader2, Plus, Settings2 } from "lucide-react";
import type { AutoRun } from "@trainfabric/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";

type AutoListResponse = {
  runs: AutoRun[];
};

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "running" || status === "provisioning") return "default";
  if (status === "done") return "secondary";
  if (status === "error" || status === "cancelled") return "outline";
  return "outline";
}

function boundLabel(run: AutoRun): string {
  const bound = run.boundDatasets ?? (run.datasetId ? [run.datasetId] : []);
  if (bound.length === 0) {
    return run.status === "awaiting_user" ? "waiting on chat…" : "choosing dataset…";
  }
  if (bound.length === 1) return bound[0];
  return `${bound.length} datasets`;
}

function computeLabel(provider: string): string {
  if (provider === "trainfabric_gpu" || provider === "modal") return "Trainfabric GPU";
  if (provider === "runner") return "Self-hosted runner";
  return provider;
}

export default function AgentsPage() {
  const [runs, setRuns] = useState<AutoRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Clerk JWT synced by NotificationAuthBridge — wait until ready; never hit /auto bare.
  const { authToken, authReady } = useJobTracker();

  useEffect(() => {
    if (!authReady) return;

    if (!authToken) {
      setLoading(false);
      setRuns([]);
      setError("Sign in required to list AutoRuns.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    apiFetch<AutoListResponse>("/auto", { token: authToken })
      .then((r) => {
        if (cancelled) return;
        setRuns(r.runs ?? []);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load agents");
        setRuns([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, authReady]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-1 py-2">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            Long-running autoresearch campaigns. Connect the GitHub App, pick or create a repo —
            goals and instructions live there — then set protocol and compute. GPU trials run on
            Trainfabric GPU or a{" "}
            <a
              href="https://github.com/cybertheory/trainfabric-gpu-runner"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              self-hosted HTTP runner
            </a>
            . See{" "}
            <Link href="/docs/agents" className="text-primary hover:underline">
              agents docs
            </Link>
            .
          </p>
        </div>
        <Button asChild>
          <Link href="/agents/new">
            <Plus className="h-4 w-4" />
            Configure agent
          </Link>
        </Button>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your AutoRuns
          </h2>
          <Button asChild variant="outline" size="sm">
            <Link href="/agents/new">
              <Settings2 className="h-3.5 w-3.5" />
              New configuration
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm">
            <p className="text-destructive">{error}</p>
            <p className="mt-2 text-muted-foreground">
              Sign in if required, or start by configuring a new agent.
            </p>
            <Button asChild className="mt-4" size="sm">
              <Link href="/agents/new">Configure agent</Link>
            </Button>
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-14 text-center">
            <Bot className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 text-base font-medium">No agents yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Configure an autoresearch agent: connect a GitHub repo (goals and instructions live
              there), freeze an experiment protocol, choose Trainfabric GPU or an HTTP GPU runner — then start.
              The agent picks datasets from the repo brief.
            </p>
            <Button asChild className="mt-5">
              <Link href="/agents/new">
                <Plus className="h-4 w-4" />
                Configure agent
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/auto/${run.id}`}
                      className="truncate font-medium hover:text-primary hover:underline"
                    >
                      {run.repo.url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "")}
                    </Link>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {run.goal?.trim()
                      ? run.goal.length > 72
                        ? `${run.goal.slice(0, 72)}…`
                        : run.goal
                      : "Loading brief from repo…"}{" "}
                    · data {boundLabel(run)} · {run.protocol.metric.name} (
                    {run.protocol.metric.direction}) · trial {run.progress.trial}/
                    {run.protocol.budget.maxTrials}
                    {run.progress.bestScore != null ? ` · best ${run.progress.bestScore}` : ""}
                    {" · "}
                    {computeLabel(run.compute.provider)}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/auto/${run.id}`}>Open</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
