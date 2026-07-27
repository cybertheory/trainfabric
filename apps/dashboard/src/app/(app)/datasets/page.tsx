"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DatasetMeta } from "@trainfabric/shared";
import { Database, Loader2, Plus, Search, Star, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DatasetCard } from "@/components/dataset-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";
import { cn, formatRows } from "@/lib/utils";

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

type SortKey = "stars" | "updated" | "rows" | "name";

export default function DiscoverPage() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>(DEMO);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<SortKey>("stars");
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

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of datasets) {
      for (const t of d.tags) {
        map.set(t, (map.get(t) ?? 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  }, [datasets]);

  const filtered = useMemo(() => {
    const list = datasets.filter((d) => {
      if (tag && !d.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
      if (!q) return true;
      const s = q.toLowerCase();
      return (
        d.name.toLowerCase().includes(s) ||
        d.owner.toLowerCase().includes(s) ||
        d.description?.toLowerCase().includes(s) ||
        d.tags.some((t) => t.toLowerCase().includes(s))
      );
    });
    return [...list].sort((a, b) => {
      switch (sort) {
        case "updated":
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        case "rows":
          return b.rowCount - a.rowCount;
        case "name":
          return `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`);
        case "stars":
        default:
          return b.stars - a.stars || b.rowCount - a.rowCount;
      }
    });
  }, [datasets, q, tag, sort]);

  const trending = useMemo(
    () => [...datasets].sort((a, b) => b.stars - a.stars || b.rowCount - a.rowCount).slice(0, 6),
    [datasets],
  );

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_260px] sm:px-6 lg:px-8">
      {/* Left filters */}
      <aside className="order-2 space-y-4 lg:order-1 lg:sticky lg:top-20 lg:self-start">
        <div className="tf-surface space-y-4 rounded-xl p-4">
          <div>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Filters
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Narrow the catalog</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Tag</label>
            <Input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="e.g. huggingface"
              className="h-9 border-[hsl(var(--border-strong))] bg-[hsl(var(--inset))]"
            />
            {tag ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setTag("")}
              >
                <X className="h-3 w-3" />
                Clear tag
              </button>
            ) : null}
          </div>

          {tagCounts.length ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Popular tags</p>
              <div className="flex flex-wrap gap-1.5">
                {tagCounts.map(([t, count]) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTag(tag === t ? "" : t)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] transition",
                      tag === t
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-[hsl(var(--border-subtle))] text-muted-foreground hover:border-[hsl(var(--border-strong))] hover:text-foreground",
                    )}
                  >
                    {t}
                    <span className="ml-1 opacity-60">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-2 border-t border-[hsl(var(--border-subtle))] pt-3">
            <p className="text-xs font-medium text-muted-foreground">Sort</p>
            <div className="flex flex-col gap-0.5">
              {(
                [
                  ["stars", "Most starred"],
                  ["updated", "Recently updated"],
                  ["rows", "Largest"],
                  ["name", "Name"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSort(id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-left text-sm transition",
                    sort === id
                      ? "bg-[hsl(var(--elevated))] text-foreground"
                      : "text-muted-foreground hover:bg-[hsl(var(--elevated))]/60 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Button asChild className="w-full" variant="outline">
          <Link href="/new">
            <Plus className="h-4 w-4" />
            Publish dataset
          </Link>
        </Button>
      </aside>

      {/* Main catalog */}
      <div className="order-1 min-w-0 space-y-5 lg:order-2">
        {activeJobs.length > 0 ? (
          <div className="tf-elevated border-primary/25 px-4 py-3">
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

        <header className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Database className="h-6 w-6 text-primary" />
                <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                  Discover
                </h1>
              </div>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Browse public Iceberg datasets. Connect to communities you care about — updates land
                in your Home feed. Agents and humans query exact column + row slices.
              </p>
            </div>
            <Button asChild className="shrink-0">
              <Link href="/new">
                <Plus className="h-4 w-4" />
                Publish
              </Link>
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-11 border-[hsl(var(--border-strong))] bg-[hsl(var(--elevated))] pl-9 pr-9"
              placeholder="Search name, owner, description, tags…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q ? (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setQ("")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {loading ? "Searching…" : `${filtered.length} dataset${filtered.length === 1 ? "" : "s"}`}
            </span>
            {tag ? (
              <Badge variant="secondary" className="gap-1 font-normal">
                tag:{tag}
                <button type="button" aria-label="Clear tag" onClick={() => setTag("")}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ) : null}
          </div>
        </header>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="tf-inset border-dashed px-4 py-14 text-center">
            <Database className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">No datasets match.</p>
            <Button asChild size="sm" variant="outline" className="mt-4">
              <Link href="/new">Publish the first one</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {filtered.map((d) => (
              <DatasetCard key={d.id} dataset={d} />
            ))}
          </div>
        )}
      </div>

      {/* Right trending */}
      <aside className="order-3 hidden space-y-4 xl:sticky xl:top-20 xl:block xl:self-start">
        <div className="tf-surface space-y-3 rounded-xl p-4">
          <div>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Trending
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Most starred on Trainfabric</p>
          </div>
          <ul className="space-y-1">
            {trending.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/datasets/${encodeURIComponent(d.owner)}/${encodeURIComponent(d.name)}`}
                  className="flex items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-[hsl(var(--elevated))]"
                >
                  <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      <span className="text-muted-foreground">{d.owner}/</span>
                      {d.name}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="h-3 w-3" />
                        {d.stars}
                      </span>
                      <span>{formatRows(d.rowCount)} rows</span>
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="tf-card space-y-2 p-4">
          <p className="text-sm font-medium">Using agents?</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Bind datasets when you start an agent — or let the agent discover from the repo brief.
          </p>
          <Link href="/agents/new" className="text-xs font-medium text-primary hover:underline">
            Start an agent →
          </Link>
        </div>
      </aside>
    </div>
  );
}
