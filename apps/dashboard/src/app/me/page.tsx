"use client";

import { useEffect, useState } from "react";
import type { DatasetMeta } from "@trainfabric/shared";
import { DatasetCard } from "@/components/dataset-card";
import { apiFetch } from "@/lib/api";
import { Separator } from "@/components/ui/separator";

export default function MePage() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [history, setHistory] = useState<unknown[]>([]);

  useEffect(() => {
    apiFetch<{ datasets: DatasetMeta[] }>("/datasets?owner=me")
      .then((r) => setDatasets(r.datasets))
      .catch(async () => {
        // Without auth filter, show empty / try list with no owner
        try {
          const r = await apiFetch<{ datasets: DatasetMeta[] }>("/datasets");
          setDatasets(r.datasets.filter((d) => d.visibility === "private" || d.owner !== "demo"));
        } catch {
          setDatasets([]);
        }
      });
  }, []);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">My datasets</h1>
        <p className="text-muted-foreground">Public and private datasets you own.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {datasets.map((d) => (
            <DatasetCard key={d.id} dataset={d} />
          ))}
          {datasets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No datasets yet. Publish one from /new.</p>
          ) : null}
        </div>
      </section>
      <Separator />
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Query history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">History appears after authenticated queries.</p>
        ) : (
          <pre className="text-xs">{JSON.stringify(history, null, 2)}</pre>
        )}
      </section>
    </div>
  );
}
