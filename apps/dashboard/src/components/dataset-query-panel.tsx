"use client";

import { useEffect, useMemo, useState } from "react";
import type { CostTier, DatasetMeta, QueryEstimate, SchemaContract } from "@trainfabric/shared";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Play,
  Sparkles,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, publicApiOrigin } from "@/lib/api";
import { cn, formatBytes, formatRows } from "@/lib/utils";

type DatasetDetail = DatasetMeta & {
  schema?: SchemaContract;
};

type QueryResult = {
  costTier: CostTier;
  url?: string;
  rowCount?: number;
  affordances?: string[];
};

type RunPhase = "idle" | "planning" | "executing" | "done" | "error";

function CostBadge({ tier }: { tier?: CostTier }) {
  if (!tier) return null;
  const variant = tier === "cache" ? "cache" : tier === "A" ? "A" : "B";
  const label =
    tier === "cache" ? "cache hit" : tier === "A" ? "Case A · zero compute" : "Case B · compute";
  return <Badge variant={variant}>{label}</Badge>;
}

function absoluteResultUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const origin = publicApiOrigin();
  return `${origin}${url.startsWith("/") ? url : `/${url}`}`;
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success("Copied");
}

export function DatasetQueryPanel({
  dataset,
  columns,
  selected,
  setSelected,
  filter,
  setFilter,
  estimate,
}: {
  dataset: DatasetDetail;
  columns: SchemaContract["columns"];
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  filter: string;
  setFilter: (v: string) => void;
  estimate: QueryEstimate | null;
}) {
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const partitionHints = useMemo(
    () => columns.filter((c) => c.isPartition).map((c) => c.name),
    [columns],
  );

  useEffect(() => {
    if (phase !== "planning" && phase !== "executing") return;
    const id = window.setInterval(() => {
      setProgress((p) => {
        if (phase === "planning") return Math.min(p + 4, 35);
        return Math.min(p + 3, 90);
      });
    }, 180);
    return () => window.clearInterval(id);
  }, [phase]);

  async function runQuery() {
    if (!dataset || phase === "planning" || phase === "executing") return;
    const started = performance.now();
    setError(null);
    setResult(null);
    setElapsedMs(null);
    setPhase("planning");
    setProgress(8);
    setStatusText("Estimating scan plan…");

    try {
      await new Promise((r) => setTimeout(r, 280));
      setPhase("executing");
      setProgress(42);
      setStatusText(
        estimate?.costTier === "B"
          ? "Running Case B query (compute)…"
          : "Reading partition-aligned files…",
      );

      const out = await apiFetch<QueryResult>(`/datasets/${dataset.id}/query`, {
        method: "POST",
        body: JSON.stringify({
          columns: selected.length ? selected : undefined,
          filter: filter || undefined,
          mode: "stream",
          limit: 1000,
        }),
      });

      setProgress(100);
      setPhase("done");
      setStatusText("Done");
      setResult(out);
      setElapsedMs(Math.round(performance.now() - started));
      if (out.affordances?.length) toast.message(out.affordances[0]);
      toast.success(`Query finished · ${out.costTier}`);
    } catch (e) {
      setPhase("error");
      setProgress(0);
      setStatusText("");
      const msg = e instanceof Error ? e.message : "Query failed";
      setError(msg);
      toast.error(msg);
    }
  }

  const resultHref = result?.url ? absoluteResultUrl(result.url) : null;
  const running = phase === "planning" || phase === "executing";

  return (
    <div className="space-y-5 pt-2">
      <div className="rounded-xl border border-border/80 bg-card/40 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">Slice builder</h2>
            <p className="text-xs text-muted-foreground">
              Pick columns + a filter. Partition filters stay on Case A when possible.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CostBadge tier={estimate?.costTier} />
            {estimate ? (
              <span className="text-xs text-muted-foreground">
                ~{formatRows(estimate.estimatedRows)} rows · {formatBytes(estimate.estimatedBytes)}
                {estimate.cacheHit ? " · cached" : ""}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Estimating…</span>
            )}
          </div>
        </div>

        {partitionHints.length ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>
              Free filters:{" "}
              {partitionHints.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="mx-0.5 font-mono text-[11px] text-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    const sample = dataset.schema?.sampleRows?.[0]?.[c];
                    const value = sample != null ? String(sample) : "2024-01-01";
                    setFilter(`${c} = '${value}'`);
                  }}
                >
                  {c}
                </button>
              ))}
            </span>
          </div>
        ) : null}

        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Columns</p>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSelected(columns.map((c) => c.name))}
            >
              All
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSelected([])}
            >
              None
            </Button>
          </div>
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {columns.map((c) => {
            const checked = selected.includes(c.name);
            return (
              <label
                key={c.name}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                  checked ? "border-primary/40 bg-primary/5" : "border-border/70 hover:bg-muted/40",
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => {
                    setSelected((prev) =>
                      v ? [...prev, c.name] : prev.filter((x) => x !== c.name),
                    );
                  }}
                />
                <span className="truncate font-mono text-xs">{c.name}</span>
                {c.isPartition ? <Badge variant="outline">partition</Badge> : null}
              </label>
            );
          })}
        </div>

        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Filter
        </label>
        <Textarea
          className="min-h-[88px] font-mono text-xs"
          placeholder="pickup_date = '2024-01-01' AND fare_amount > 10"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          disabled={running}
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={runQuery} disabled={running || selected.length === 0}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Running…" : "Run query"}
          </Button>
          {resultHref ? (
            <Button variant="outline" asChild>
              <a href={resultHref} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4" />
                Download parquet
              </a>
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {selected.length}/{columns.length} columns
            {filter ? " · filtered" : " · full scan of selected columns"}
          </span>
        </div>

        {running || phase === "done" || phase === "error" ? (
          <div className="mt-4 space-y-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                ) : phase === "done" ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Square className="h-3.5 w-3.5 text-destructive" />
                )}
                {statusText || (phase === "error" ? "Failed" : "Ready")}
              </span>
              {elapsedMs != null ? <span className="text-muted-foreground">{elapsedMs} ms</span> : null}
            </div>
            <Progress value={progress} className={cn(running && "animate-pulse")} />
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {result ? (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card/50">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold tracking-tight">Result</p>
              <p className="text-xs text-muted-foreground">
                {formatRows(result.rowCount ?? 0)} rows · tier {result.costTier}
                {elapsedMs != null ? ` · ${elapsedMs} ms` : ""}
              </p>
            </div>
            <CostBadge tier={result.costTier} />
          </div>

          <div className="space-y-3 p-4">
            {resultHref ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Artifact URL
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <a
                    href={resultHref}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 font-mono text-[11px] text-primary hover:border-primary/50 hover:bg-primary/10"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70 group-hover:opacity-100" />
                    <span className="truncate underline-offset-2 group-hover:underline">{resultHref}</span>
                  </a>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(resultHref)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <a href={resultHref} target="_blank" rel="noreferrer">
                        <Download className="h-3.5 w-3.5" />
                        Open
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Inline result returned (no downloadable artifact URL).
              </p>
            )}

            {result.affordances?.length ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {result.affordances.map((a) => (
                  <li key={a}>→ {a}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
