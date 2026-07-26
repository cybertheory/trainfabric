"use client";

import { useEffect, useState } from "react";
import type { DatasetMeta } from "@trainfabric/shared";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DatasetCard } from "@/components/dataset-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";

const DEMO: DatasetMeta[] = [
  {
    id: "demo_nyc_taxi",
    owner: "demo",
    visibility: "public",
    name: "nyc-taxi-sample",
    description: "NYC yellow taxi trips sample — partitioned by pickup_date",
    tags: ["transport", "nyc", "taxi"],
    stars: 3,
    latestSnapshotId: "snap1",
    rowCount: 1000,
    sizeBytes: 120000,
    kind: "base",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: "demo_sensors",
    owner: "demo",
    visibility: "public",
    name: "iot-sensors",
    description: "Synthetic IoT time-series",
    tags: ["iot", "timeseries"],
    stars: 3,
    latestSnapshotId: "snap1",
    rowCount: 5000,
    sizeBytes: 800000,
    kind: "base",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

export default function HomePage() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>(DEMO);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [loading, setLoading] = useState(false);
  const { activeJobs, setDrawerOpen } = useJobTracker();

  useEffect(() => {
    const search = new URLSearchParams(window.location.search).get("search");
    if (search) setQ(search);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      if (tag) params.set("tag", tag);
      apiFetch<{ datasets: DatasetMeta[] }>(`/datasets?${params}`)
        .then((r) => {
          if (r.datasets?.length) setDatasets(r.datasets);
        })
        .catch(() => {
          /* keep DEMO */
        })
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(t);
  }, [q, tag]);

  const filtered = datasets.filter((d) => {
    if (tag && !d.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      d.name.toLowerCase().includes(s) ||
      d.description?.toLowerCase().includes(s) ||
      d.tags.some((t) => t.toLowerCase().includes(s))
    );
  });

  return (
    <div className="space-y-8">
      {activeJobs.length > 0 ? (
        <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>
                {activeJobs.length === 1
                  ? `Ingesting ${activeJobs[0]!.name}…`
                  : `${activeJobs.length} ingest jobs running`}
              </span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setDrawerOpen(true)}>
              Open activity
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {activeJobs.slice(0, 3).map((j) => (
              <div key={j.jobId} className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="truncate">{j.name}</span>
                  <span>{Math.round(j.progress)}%</span>
                </div>
                <Progress value={j.progress} className="h-1.5" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Discover</h1>
        <p className="max-w-2xl text-muted-foreground">
          Browse public Iceberg datasets. Connect to communities you care about — updates land in
          your Home feed. Agents and humans query exact column + row slices.
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search name, description, tags…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Input
            className="w-40"
            placeholder="Filter tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          />
        </div>
      </section>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => (
            <DatasetCard key={d.id} dataset={d} />
          ))}
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No datasets match.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
