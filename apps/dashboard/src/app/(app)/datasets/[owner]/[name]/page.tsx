"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { AutoRun, DatasetMeta, QueryEstimate, SavedQuery, SchemaContract } from "@trainfabric/shared";
import { Bot, GitBranch, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ForkDialog } from "@/components/fork-dialog";
import { DatasetConnectButton } from "@/components/dataset-connect-button";
import { DatasetAgentSidebar } from "@/components/dataset-agent-sidebar";
import { DatasetQueryPanel } from "@/components/dataset-query-panel";
import { AutoConfigurePanel } from "@/components/auto-configure-panel";
import { apiFetch } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";
import { formatBytes, formatRows } from "@/lib/utils";

type QueryRow = SavedQuery & { resultUrl?: string };

type DatasetDetail = DatasetMeta & {
  schema?: SchemaContract;
  materializationDecision?: { mode: string; reason: string };
  stale?: boolean;
};

export default function DatasetDetailPage() {
  const params = useParams<{ owner: string; name: string }>();
  const owner = params.owner ? decodeURIComponent(params.owner) : "";
  const name = params.name ? decodeURIComponent(params.name) : "";
  const { authToken } = useJobTracker();
  const [dataset, setDataset] = useState<DatasetDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [estimate, setEstimate] = useState<QueryEstimate | null>(null);
  const [snapshots, setSnapshots] = useState<unknown[]>([]);
  const [lineage, setLineage] = useState<unknown>(null);
  const [queries, setQueries] = useState<QueryRow[]>([]);
  const [autoRuns, setAutoRuns] = useState<AutoRun[]>([]);

  useEffect(() => {
    if (!owner || !name) return;
    setNotFound(false);
    setDataset(null);
    apiFetch<{ datasets: DatasetDetail[] }>(`/datasets?search=${encodeURIComponent(name)}`)
      .then(async (r) => {
        const found =
          r.datasets.find((d) => d.owner === owner && d.name === name) ??
          r.datasets.find((d) => d.name === name) ??
          r.datasets[0];
        if (!found) {
          setNotFound(true);
          return;
        }
        const full = await apiFetch<DatasetDetail>(`/datasets/${found.id}`);
        setDataset(full);
        setSelected(full.schema?.columns.map((c) => c.name) ?? []);
        const seeded = full.schema?.sampleRows ?? [];
        setPreview(seeded);
        const partition = full.schema?.columns.find((c) => c.isPartition)?.name;
        if (partition) {
          const sample = seeded[0]?.[partition];
          if (sample != null) setFilter(`${partition} = '${String(sample)}'`);
        }
        apiFetch<{ rows: Record<string, unknown>[] }>(`/datasets/${found.id}/sample`, {
          method: "POST",
          body: JSON.stringify({ n: 20 }),
        })
          .then((s) => {
            if (s.rows?.length) setPreview(s.rows);
          })
          .catch(() => {
            /* keep seeded rows */
          });
        apiFetch<{ snapshots: unknown[] }>(`/datasets/${found.id}/snapshots`)
          .then((s) => setSnapshots(s.snapshots))
          .catch(() => setSnapshots([]));
        apiFetch(`/datasets/${found.id}/lineage`)
          .then(setLineage)
          .catch(() => setLineage(null));
        apiFetch<{ queries: QueryRow[] }>(`/datasets/${found.id}/queries`)
          .then((q) => setQueries(q.queries))
          .catch(() => setQueries([]));
        apiFetch<{ runs: AutoRun[] }>(`/datasets/${found.id}/auto`, { token: authToken })
          .then((a) => setAutoRuns(a.runs ?? []))
          .catch(() => setAutoRuns([]));
      })
      .catch(() => setNotFound(true));
  }, [owner, name, authToken]);

  const columns = dataset?.schema?.columns ?? [];

  useEffect(() => {
    if (!dataset?.id) return;
    const t = setTimeout(() => {
      apiFetch<QueryEstimate>(`/datasets/${dataset.id}/estimate`, {
        method: "POST",
        body: JSON.stringify({
          columns: selected.length ? selected : undefined,
          filter: filter || undefined,
        }),
      })
        .then(setEstimate)
        .catch(() => setEstimate(null));
    }, 300);
    return () => clearTimeout(t);
  }, [dataset?.id, selected, filter]);

  const storageStory = useMemo(() => {
    if (dataset?.kind !== "derived") return null;
    const mode = dataset.materializationDecision?.mode;
    if (mode === "pointer") return "Pointer view — no data duplicated";
    if (mode === "materialized") return `Materialized — ${formatBytes(dataset.sizeBytes)} new files`;
    return dataset.materializationDecision?.reason;
  }, [dataset]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">
          Dataset <code>{owner}/{name}</code> not found.
        </p>
      </div>
    );
  }
  if (!dataset) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              <span className="text-muted-foreground">{dataset.owner}/</span>
              {dataset.name}
            </h1>
            <Badge variant="outline">{dataset.visibility}</Badge>
            {dataset.kind === "derived" ? <Badge variant="secondary">derived</Badge> : null}
            {dataset.stale ? <Badge variant="outline">stale</Badge> : null}
          </div>
          <p className="max-w-2xl text-muted-foreground">{dataset.description || "No description"}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{formatRows(dataset.rowCount)} rows</span>
            <span>{formatBytes(dataset.sizeBytes)}</span>
            <span className="font-mono text-xs">snapshot {dataset.latestSnapshotId || "—"}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dataset.tags.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
          </div>
          {storageStory ? <p className="text-sm text-accent-foreground">{storageStory}</p> : null}
        </div>
        <div className="flex gap-2">
          <ForkDialog source={dataset} queries={queries} />
          <DatasetConnectButton datasetId={dataset.id} />
          <Button variant="outline" size="sm" disabled title="Connections">
            <Link2 className="h-4 w-4" />
            {dataset.connections}
          </Button>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Tabs defaultValue="data">
            <TabsList>
              <TabsTrigger value="data">Data</TabsTrigger>
              <TabsTrigger value="schema">Schema</TabsTrigger>
              <TabsTrigger value="query">Query</TabsTrigger>
              <TabsTrigger value="agents">Agents</TabsTrigger>
              <TabsTrigger value="versions">Versions</TabsTrigger>
              {dataset.kind === "derived" ? <TabsTrigger value="lineage">Lineage</TabsTrigger> : null}
            </TabsList>

            <TabsContent value="data" className="space-y-3 pt-2">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">Sample rows</h2>
                  <p className="text-xs text-muted-foreground">
                    First {preview.length || 0} rows from the latest snapshot — not a billed query.
                  </p>
                </div>
              </div>
              <ResultsTable rows={preview} />
            </TabsContent>

            <TabsContent value="schema" className="pt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Nullable</TableHead>
                    <TableHead>Null rate</TableHead>
                    <TableHead>Distinct</TableHead>
                    <TableHead>Min</TableHead>
                    <TableHead>Max</TableHead>
                    <TableHead>Partition</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {columns.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.type}</TableCell>
                      <TableCell>{c.nullable ? "yes" : "no"}</TableCell>
                      <TableCell>{c.nullRate != null ? (c.nullRate * 100).toFixed(1) + "%" : "—"}</TableCell>
                      <TableCell>{c.distinctCount ?? "—"}</TableCell>
                      <TableCell>{c.min ?? "—"}</TableCell>
                      <TableCell>{c.max ?? "—"}</TableCell>
                      <TableCell>{c.isPartition ? <Badge>partition</Badge> : null}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="query">
              <DatasetQueryPanel
                dataset={dataset}
                columns={columns}
                selected={selected}
                setSelected={setSelected}
                filter={filter}
                setFilter={setFilter}
                estimate={estimate}
                queries={queries}
                onQueriesChange={setQueries}
              />
            </TabsContent>

            <TabsContent value="agents" className="space-y-4 pt-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="flex items-center gap-2 text-sm font-medium">
                    <Bot className="h-4 w-4 text-primary" />
                    Autoresearch agents
                  </h2>
                  <p className="max-w-lg text-xs text-muted-foreground">
                    Start an autoresearch agent on this dataset, or use the full wizard at{" "}
                    <Link href="/agents/new" className="text-primary hover:underline">
                      Start an agent
                    </Link>
                    .
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/agents">All agents</Link>
                </Button>
              </div>
              <AutoConfigurePanel
                datasetId={dataset.id}
                snapshotId={dataset.latestSnapshotId || dataset.schema?.snapshotId}
              />
              {autoRuns.length > 0 ? (
                <ul className="divide-y rounded-lg border text-sm">
                  {autoRuns.map((run) => (
                    <li key={run.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{run.status}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {run.repo.url} · trial {run.progress.trial}/
                          {run.protocol.budget.maxTrials}
                        </p>
                      </div>
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/auto/${run.id}`}>Open</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No AutoRuns of yours on this dataset yet.</p>
              )}
            </TabsContent>

            <TabsContent value="versions" className="space-y-2 pt-2">
              {snapshots.length === 0 ? (
                <p className="text-sm text-muted-foreground">No snapshots yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {snapshots.map((s, i) => {
                    const snap = s as { snapshotId?: string; timestampMs?: number };
                    return (
                      <li key={i} className="flex items-center gap-2 rounded-md border px-3 py-2">
                        <GitBranch className="h-4 w-4" />
                        <code>{snap.snapshotId}</code>
                        <span className="text-muted-foreground">
                          {snap.timestampMs ? new Date(snap.timestampMs).toLocaleString() : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {dataset.kind === "derived" && dataset.materializationDecision?.mode === "materialized" ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    apiFetch(`/datasets/${dataset.id}/rebuild`, { method: "POST" })
                      .then(() => toast.success("Rebuild started"))
                      .catch((e) => toast.error(String(e)))
                  }
                >
                  Rebuild
                </Button>
              ) : null}
            </TabsContent>

            <TabsContent value="lineage" className="pt-2">
              <pre className="overflow-auto rounded-md border bg-muted/40 p-4 text-xs">
                {JSON.stringify(lineage, null, 2)}
              </pre>
            </TabsContent>
          </Tabs>
        </div>

        <DatasetAgentSidebar dataset={dataset} />
      </div>
    </div>
  );
}

function ResultsTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No rows.</p>;
  const cols = Object.keys(rows[0]!);
  return (
    <div className="overflow-x-auto rounded-lg border border-border/80">
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {cols.map((c) => (
                <TableCell key={c} className="font-mono text-xs">
                  {String(r[c] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
