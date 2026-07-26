"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  Cable,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Play,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import type { CostTier, DatasetMeta, SchemaContract } from "@trainfabric/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CodeHighlight } from "@/components/code-highlight";
import { AutoConfigurePanel } from "@/components/auto-configure-panel";
import { apiFetch, publicApiOrigin } from "@/lib/api";
import { cn, formatBytes, formatRows } from "@/lib/utils";

type DatasetDetail = DatasetMeta & { schema?: SchemaContract };

type Lang = "json" | "bash" | "text" | "url";

async function copyText(label: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  } catch {
    toast.error("Could not copy");
  }
}

function CopyBlock({
  label,
  value,
  language,
  className,
}: {
  label: string;
  value: string;
  language?: Lang;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border/80", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
          {language ? <span className="ml-2 normal-case opacity-70">{language}</span> : null}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={async () => {
            await copyText(label, value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <CodeHighlight code={value} language={language ?? "text"} />
    </div>
  );
}

function CostBadge({ tier }: { tier?: CostTier }) {
  if (!tier) return null;
  const label =
    tier === "cache" ? "cache" : tier === "A" ? "Case A" : tier === "B" ? "Case B" : String(tier);
  return <Badge variant={tier === "cache" ? "cache" : tier === "A" ? "A" : "B"}>{label}</Badge>;
}

function ApiPlayground({
  title,
  path,
  initialBody,
  runLabel,
}: {
  title: string;
  path: string;
  initialBody: Record<string, unknown>;
  runLabel: string;
}) {
  const [bodyText, setBodyText] = useState(() => JSON.stringify(initialBody, null, 2));
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    tier?: CostTier;
    rows?: number;
    bytes?: number;
    url?: string;
    ms?: number;
  } | null>(null);

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    setResponse(null);
    setMeta(null);
    const started = performance.now();
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        throw new Error("Request body must be valid JSON");
      }
      const out = await apiFetch<Record<string, unknown>>(path, {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      const ms = Math.round(performance.now() - started);
      setResponse(JSON.stringify(out, null, 2));
      setMeta({
        tier: out.costTier as CostTier | undefined,
        rows: (out.estimatedRows as number | undefined) ?? (out.rowCount as number | undefined),
        bytes: out.estimatedBytes as number | undefined,
        url: typeof out.url === "string" ? out.url : undefined,
        ms,
      });
      toast.success(`${runLabel} ok · ${ms} ms`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  const resultHref = meta?.url
    ? meta.url.startsWith("http")
      ? meta.url
      : `${publicApiOrigin()}${meta.url.startsWith("/") ? meta.url : `/${meta.url}`}`
    : null;

  return (
    <div className="overflow-hidden rounded-lg border border-border/80">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
          <span className="ml-2 normal-case opacity-70">playground</span>
        </span>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={running}
          onClick={() => void run()}
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {running ? "Running…" : runLabel}
        </Button>
      </div>

      <div className="space-y-0 border-b border-border/50 bg-[#0b1218]">
        <p className="px-3 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          POST {path}
        </p>
        <Textarea
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          disabled={running}
          spellCheck={false}
          className="min-h-[110px] resize-y rounded-none border-0 bg-transparent px-3 py-2 font-mono text-[11px] leading-relaxed text-[hsl(145_55%_62%)] shadow-none focus-visible:ring-0"
        />
      </div>

      {error ? (
        <p className="border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {response ? (
        <div>
          <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-muted/10 px-3 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Response
            </span>
            {meta?.tier ? <CostBadge tier={meta.tier} /> : null}
            {meta?.rows != null ? (
              <span className="text-[10px] text-muted-foreground">~{formatRows(meta.rows)} rows</span>
            ) : null}
            {meta?.bytes != null ? (
              <span className="text-[10px] text-muted-foreground">{formatBytes(meta.bytes)}</span>
            ) : null}
            {meta?.ms != null ? (
              <span className="text-[10px] text-muted-foreground">{meta.ms} ms</span>
            ) : null}
            {resultHref ? (
              <a
                href={resultHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Open artifact
              </a>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-1.5 text-[10px]"
              onClick={() => void copyText("response", response)}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <CodeHighlight code={response} language="json" className="max-h-64" />
        </div>
      ) : (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          Edit the JSON body, then hit {runLabel} to call the live API from here.
        </p>
      )}
    </div>
  );
}

export function DatasetAgentSidebar({ dataset }: { dataset: DatasetDetail }) {
  const api = publicApiOrigin();
  const mcpUrl = `${api}/mcp`;
  const partitionCols =
    dataset.schema?.columns.filter((c) => c.isPartition).map((c) => c.name) ?? [];
  const examplePartition = partitionCols[0];
  const sample = dataset.schema?.sampleRows?.[0];
  const exampleFilter = examplePartition
    ? `${examplePartition} = '${sample?.[examplePartition] != null ? String(sample[examplePartition]) : "2024-01-01"}'`
    : "fare_amount > 10";
  const colList =
    (dataset.schema?.columns.slice(0, 4).map((c) => c.name) ?? []).join(", ") || "*";
  const defaultColumns = useMemo(
    () => (dataset.schema?.columns.slice(0, 4).map((c) => c.name) ?? []).filter(Boolean),
    [dataset.schema],
  );

  const agentPrompt = useMemo(
    () =>
      [
        `Use Trainfabric to query dataset ${dataset.owner}/${dataset.name}.`,
        `dataset_id: ${dataset.id}`,
        `MCP endpoint: ${mcpUrl}`,
        "",
        "Steps:",
        "1) Call inspect_schema with this dataset_id.",
        "2) Call estimate_query before fetching (check cost tiers A vs B).",
        "3) Call query_slice with columns + filter.",
        examplePartition
          ? `Prefer filters on partition column \`${examplePartition}\` for free Case A reads.`
          : "Avoid full-table scans when possible.",
        "",
        `Example filter: ${exampleFilter}`,
        `Example columns: ${colList}`,
      ].join("\n"),
    [dataset, mcpUrl, exampleFilter, examplePartition, colList],
  );

  const mcpConfig = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            trainfabric: {
              url: mcpUrl,
            },
          },
        },
        null,
        2,
      ),
    [mcpUrl],
  );

  const estimateBody = useMemo(
    () => ({
      columns: defaultColumns.length ? defaultColumns : undefined,
      filter: exampleFilter,
    }),
    [defaultColumns, exampleFilter],
  );

  const queryBody = useMemo(
    () => ({
      columns: defaultColumns.length ? defaultColumns : undefined,
      filter: exampleFilter,
      mode: "stream",
      limit: 100,
    }),
    [defaultColumns, exampleFilter],
  );

  const curlEstimate = useMemo(
    () =>
      [
        `curl -sS -X POST '${api}/datasets/${dataset.id}/estimate' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '${JSON.stringify(estimateBody)}'`,
      ].join("\n"),
    [api, dataset.id, estimateBody],
  );

  const curlQuery = useMemo(
    () =>
      [
        `curl -sS -X POST '${api}/datasets/${dataset.id}/query' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '${JSON.stringify(queryBody)}'`,
      ].join("\n"),
    [api, dataset.id, queryBody],
  );

  return (
    <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Agent kit
        </p>
        <h2 className="text-lg font-semibold tracking-tight">Query this dataset</h2>
        <p className="text-sm text-muted-foreground">
          Copy into your agent — or run estimate / query right here.
        </p>
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4 text-primary" />
          Prompt for your agent
        </div>
        <CopyBlock label="agent prompt" value={agentPrompt} language="text" />
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Cable className="h-4 w-4 text-primary" />
          MCP connect
        </div>
        <CopyBlock label="MCP URL" value={mcpUrl} language="url" />
        <CopyBlock label="Cursor mcp.json" value={mcpConfig} language="json" />
        <p className="text-xs text-muted-foreground">
          Tools: <code className="text-[11px]">inspect_schema</code>,{" "}
          <code className="text-[11px]">estimate_query</code>,{" "}
          <code className="text-[11px]">query_slice</code>
        </p>
      </section>

      <AutoConfigurePanel
        datasetId={dataset.id}
        snapshotId={dataset.latestSnapshotId || dataset.schema?.snapshotId}
      />

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Terminal className="h-4 w-4 text-primary" />
          API playground
        </div>
        <ApiPlayground
          title="estimate"
          path={`/datasets/${dataset.id}/estimate`}
          initialBody={estimateBody}
          runLabel="Run estimate"
        />
        <ApiPlayground
          title="query slice"
          path={`/datasets/${dataset.id}/query`}
          initialBody={queryBody}
          runLabel="Run query"
        />
        <CopyBlock label="estimate curl" value={curlEstimate} language="bash" />
        <CopyBlock label="query curl" value={curlQuery} language="bash" />
        <CopyBlock label="dataset id" value={dataset.id} language="text" />
      </section>

      {partitionCols.length ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Cheap filters: </span>
          partition on{" "}
          {partitionCols.map((c) => (
            <code key={c} className="mx-0.5 text-[11px] text-foreground">
              {c}
            </code>
          ))}
          → Case A (no compute bill).
        </div>
      ) : null}
    </aside>
  );
}
