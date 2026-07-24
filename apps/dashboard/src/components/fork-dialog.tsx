"use client";

import { useEffect, useMemo, useState } from "react";
import type { DatasetMeta, SavedQuery } from "@trainfabric/shared";
import { GitFork, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { formatRows } from "@/lib/utils";
import { cn } from "@/lib/utils";

type QueryRow = SavedQuery & { resultUrl?: string };

export function ForkDialog({
  source,
  queries: initialQueries,
  onCreated,
}: {
  source: DatasetMeta;
  queries: QueryRow[];
  onCreated?: (datasetId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${source.name}-fork`);
  const [selected, setSelected] = useState<string[]>([]);
  const [combine, setCombine] = useState<"single" | "union">("single");
  const [mat, setMat] = useState("auto");
  const [queries, setQueries] = useState<QueryRow[]>(initialQueries);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setQueries(initialQueries);
  }, [initialQueries]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch<{ queries: QueryRow[] }>(`/datasets/${source.id}/queries`)
      .then((r) => setQueries(r.queries))
      .catch(() => toast.error("Could not load queries"))
      .finally(() => setLoading(false));
  }, [open, source.id]);

  const picked = useMemo(
    () => queries.filter((q) => selected.includes(q.id)),
    [queries, selected],
  );

  useEffect(() => {
    if (picked.length > 1) setCombine("union");
    else setCombine("single");
  }, [picked.length]);

  async function create() {
    if (!picked.length) {
      toast.error("Select at least one query to fork");
      return;
    }
    setCreating(true);
    try {
      const sources = picked.map((q) => ({
        datasetId: q.datasetId,
        snapshotPin: q.snapshotId,
        query: {
          datasetId: q.datasetId,
          columns: q.columns,
          filter: q.filter,
          snapshot: q.snapshotId,
          limit: q.limit,
        },
      }));
      const res = await apiFetch<{
        datasetId: string;
        materialization: { mode: string; reason: string };
      }>("/datasets/derived", {
        method: "POST",
        body: JSON.stringify({
          name,
          visibility: "private",
          tags: ["fork", "derived"],
          description: `Fork of ${picked.length} quer${picked.length === 1 ? "y" : "ies"} from ${source.name}`,
          spec: {
            sources,
            combine: { op: picked.length > 1 ? "union" : combine },
            materialization: mat,
            followLatest: !picked.some((q) => q.snapshotId),
          },
        }),
      });
      toast.success(`Forked as ${res.datasetId} (${res.materialization.mode})`);
      setOpen(false);
      onCreated?.(res.datasetId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <GitFork className="h-4 w-4" />
          Fork
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fork into a new dataset</DialogTitle>
          <DialogDescription>
            Fuse one or more saved queries from <code>{source.name}</code> (yours + public) into a
            derived dataset.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Fork name" />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Queries to fuse
              </p>
              <span className="text-xs text-muted-foreground">{selected.length} selected</span>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border/70 p-2">
              {loading ? (
                <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading queries…
                </p>
              ) : queries.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No saved queries yet. Run a query on the Query tab first — results are stored
                  automatically.
                </p>
              ) : (
                queries.map((q) => {
                  const checked = selected.includes(q.id);
                  return (
                    <label
                      key={q.id}
                      className={cn(
                        "flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                        checked ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted/40",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          setSelected((prev) =>
                            v ? [...prev, q.id] : prev.filter((id) => id !== q.id),
                          )
                        }
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">{q.name}</span>
                          {q.visibility === "public" ? <Badge variant="outline">public</Badge> : null}
                          {q.costTier ? <Badge variant={q.costTier === "A" ? "A" : q.costTier === "B" ? "B" : "cache"}>{q.costTier}</Badge> : null}
                          {q.owner !== "anon" ? (
                            <span className="text-[11px] text-muted-foreground">by {q.owner}</span>
                          ) : null}
                        </div>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {q.filter || "(no filter)"}
                          {q.columns?.length ? ` · ${q.columns.length} cols` : ""}
                          {q.rowCount != null ? ` · ${formatRows(q.rowCount)} rows` : ""}
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select
              value={combine}
              onValueChange={(v) => setCombine(v as "single" | "union")}
              disabled={picked.length > 1}
            >
              <SelectTrigger>
                <SelectValue placeholder="Combine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">single</SelectItem>
                <SelectItem value="union">union</SelectItem>
              </SelectContent>
            </Select>
            <Select value={mat} onValueChange={setMat}>
              <SelectTrigger>
                <SelectValue placeholder="Materialization" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto</SelectItem>
                <SelectItem value="pointer">pointer</SelectItem>
                <SelectItem value="materialized">materialized</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={creating || !selected.length}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitFork className="h-4 w-4" />}
              {creating ? "Forking…" : "Fork dataset"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
