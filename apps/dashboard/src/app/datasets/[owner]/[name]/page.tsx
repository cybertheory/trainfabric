"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { CostTier, DatasetMeta, QueryEstimate, SchemaContract } from "@trainfabric/shared";
import { Star, Download, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { CreateDerivedDialog } from "@/components/create-derived-dialog";
import { apiFetch } from "@/lib/api";
import { formatBytes, formatRows } from "@/lib/utils";

type DatasetDetail = DatasetMeta & {
  schema?: SchemaContract;
  materializationDecision?: { mode: string; reason: string };
  stale?: boolean;
};

function CostBadge({ tier }: { tier?: CostTier }) {
  if (!tier) return null;
  const variant = tier === "cache" ? "cache" : tier === "A" ? "A" : "B";
  const label = tier === "cache" ? "cache hit" : tier === "A" ? "Case A · zero compute" : "Case B · compute";
  return <Badge variant={variant}>{label}</Badge>;
}

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
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<unknown[]>([]);
  const [lineage, setLineage] = useState<unknown>(null);

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
        apiFetch<{ rows: Record<string, unknown>[] }>(`/datasets/${found.id}/sample`, {
          method: "POST",
          body: JSON.stringify({ n: 20 }),
        })
          .then((s) => setPreview(s.rows))
          .catch(() => setPreview(full.schema?.sampleRows ?? []));
        apiFetch<{ snapshots: unknown[] }>(`/datasets/${found.id}/snapshots`)
          .then((s) => setSnapshots(s.snapshots))
          .catch(() => setSnapshots([]));
        apiFetch(`/datasets/${found.id}/lineage`)
          .then(setLineage)
          .catch(() => setLineage(null));
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

  async function runQuery() {
    if (!dataset) return;
    try {
      const result = await apiFetch<{
        costTier: CostTier;
        url?: string;
        arrowBase64?: string;
        rowCount?: number;
        affordances?: string[];
      }>(`/datasets/${dataset.id}/query`, {
        method: "POST",
        body: JSON.stringify({
          columns: selected.length ? selected : undefined,
          filter: filter || undefined,
          mode: "stream",
          limit: 100,
        }),
      });
      setResultUrl(result.url ?? null);
      if (result.affordances?.length) toast.message(result.affordances[0]);
      // For MVP UI, show estimate row count; Arrow decode would need apache-arrow in browser
      setResults([{ note: `Returned ${result.rowCount ?? "?"} rows`, costTier: result.costTier, url: result.url }]);
      toast.success(`Query ${result.costTier}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Query failed");
    }
  }

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              <span className="text-muted-foreground">{dataset.owner}/</span>
              {dataset.name}
            </h1>
            <Badge variant="outline">{dataset.visibility}</Badge>
            {dataset.kind === "derived" ? <Badge variant="secondary">derived</Badge> : null}
            {dataset.stale ? <Badge variant="outline">stale</Badge> : null}
          </div>
          <p className="max-w-2xl text-muted-foreground">{dataset.description}</p>
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span>{formatRows(dataset.rowCount)} rows</span>
            <span>{formatBytes(dataset.sizeBytes)}</span>
            <span>snapshot {dataset.latestSnapshotId || "—"}</span>
          </div>
          {storageStory ? <p className="text-sm text-accent-foreground">{storageStory}</p> : null}
        </div>
        <div className="flex gap-2">
          <CreateDerivedDialog source={dataset} />
          <Button variant="outline" size="sm">
            <Star className="h-4 w-4" />
            {dataset.stars}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="query">Query</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          {dataset.kind === "derived" ? <TabsTrigger value="lineage">Lineage</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {dataset.tags.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
          </div>
          {dataset.materializationDecision ? (
            <p className="text-sm text-muted-foreground">{dataset.materializationDecision.reason}</p>
          ) : null}
        </TabsContent>

        <TabsContent value="schema">
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

        <TabsContent value="preview">
          <ResultsTable rows={preview} />
        </TabsContent>

        <TabsContent value="query" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <CostBadge tier={estimate?.costTier} />
            {estimate ? (
              <span className="text-xs text-muted-foreground">
                ~{formatRows(estimate.estimatedRows)} rows · {formatBytes(estimate.estimatedBytes)}
                {estimate.cacheHit ? " · cached" : ""}
              </span>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {columns.map((c) => (
              <label key={c.name} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.includes(c.name)}
                  onCheckedChange={(v) => {
                    setSelected((prev) =>
                      v ? [...prev, c.name] : prev.filter((x) => x !== c.name),
                    );
                  }}
                />
                {c.name}
                {c.isPartition ? <Badge variant="outline">partition</Badge> : null}
              </label>
            ))}
          </div>
          <Textarea
            placeholder="Filter e.g. pickup_date = '2024-01-01' AND fare_amount > 10"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="flex gap-2">
            <Button onClick={runQuery}>Run query</Button>
            {resultUrl ? (
              <Button variant="outline" asChild>
                <a href={resultUrl} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" />
                  Download
                </a>
              </Button>
            ) : null}
          </div>
          <Separator />
          {results ? <ResultsTable rows={results} /> : null}
        </TabsContent>

        <TabsContent value="versions" className="space-y-2">
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

        <TabsContent value="lineage">
          <pre className="overflow-auto rounded-md border bg-muted/40 p-4 text-xs">
            {JSON.stringify(lineage, null, 2)}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ResultsTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No rows.</p>;
  const cols = Object.keys(rows[0]!);
  return (
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
              <TableCell key={c}>{String(r[c] ?? "")}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
