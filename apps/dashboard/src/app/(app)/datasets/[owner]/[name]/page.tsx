"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { DatasetMeta, QueryEstimate, SavedQuery, SchemaContract } from "@trainfabric/shared";
import { Star, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ForkDialog } from "@/components/fork-dialog";
import { DatasetAgentSidebar } from "@/components/dataset-agent-sidebar";
import { DatasetQueryPanel } from "@/components/dataset-query-panel";
import { apiFetch } from "@/lib/api";
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
  const [dataset, setDataset] = useState<DatasetDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [estimate, setEstimate] = useState<QueryEstimate | null>(null);
  const [snapshots, setSnapshots] = useState<unknown[]>([]);
  const [lineage, setLineage] = useState<unknown>(null);
  const [queries, setQueries] = useState<QueryRow[]>([]);

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
      })
      .catch(() => setNotFound(true));
  }, [owner, name]);

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
      <p className="text-muted-foreground">
        Dataset <code>{owner}/{name}</code> not found.
      </p>
    );
  }
  if (!dataset) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-8">
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
          <Button variant="outline" size="sm">
            <Star className="h-4 w-4" />
            {dataset.stars}
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
