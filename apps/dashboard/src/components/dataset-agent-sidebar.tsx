"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Terminal, Bot, Cable } from "lucide-react";
import { toast } from "sonner";
import type { DatasetMeta, SchemaContract } from "@trainfabric/shared";
import { Button } from "@/components/ui/button";
import { publicApiOrigin } from "@/lib/api";
import { cn } from "@/lib/utils";

type DatasetDetail = DatasetMeta & { schema?: SchemaContract };

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
  language?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border/80 bg-muted/30", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
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
      <pre className="max-h-56 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
        {value}
      </pre>
    </div>
  );
}

export function DatasetAgentSidebar({ dataset }: { dataset: DatasetDetail }) {
  const api = publicApiOrigin();
  const mcpUrl = `${api}/mcp`;
  const partitionCols =
    dataset.schema?.columns.filter((c) => c.isPartition).map((c) => c.name) ?? [];
  const examplePartition = partitionCols[0];
  const exampleFilter = examplePartition
    ? `${examplePartition} = '2024-01-01'`
    : "fare_amount > 10";
  const colList =
    (dataset.schema?.columns.slice(0, 4).map((c) => c.name) ?? []).join(", ") || "*";

  const agentPrompt = useMemo(
    () =>
      [
        `Use Trainfabric to query dataset ${dataset.owner}/${dataset.name}.`,
        `dataset_id: ${dataset.id}`,
        `MCP endpoint: ${mcpUrl}`,
        "",
        "Steps:",
        "1) Call inspect_schema with this dataset_id.",
        "2) Call estimate_query before fetching (check costTier A vs B).",
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

  const curlEstimate = useMemo(
    () =>
      [
        `curl -sS -X POST '${api}/datasets/${dataset.id}/estimate' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '${JSON.stringify({ columns: colList.split(", ").filter(Boolean), filter: exampleFilter })}'`,
      ].join("\n"),
    [api, dataset.id, colList, exampleFilter],
  );

  const curlQuery = useMemo(
    () =>
      [
        `curl -sS -X POST '${api}/datasets/${dataset.id}/query' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '${JSON.stringify({
          columns: colList.split(", ").filter(Boolean),
          filter: exampleFilter,
          mode: "stream",
          limit: 100,
        })}'`,
      ].join("\n"),
    [api, dataset.id, colList, exampleFilter],
  );

  return (
    <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Agent kit
        </p>
        <h2 className="text-lg font-semibold tracking-tight">Query this dataset</h2>
        <p className="text-sm text-muted-foreground">
          Paste into Cursor / Claude / your agent. Same slice API the UI uses.
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

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Terminal className="h-4 w-4 text-primary" />
          HTTP API
        </div>
        <CopyBlock label="estimate" value={curlEstimate} language="bash" />
        <CopyBlock label="query slice" value={curlQuery} language="bash" />
        <CopyBlock
          label="dataset id"
          value={dataset.id}
          language="id"
        />
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
