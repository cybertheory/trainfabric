"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DatasetMeta, SocialPost } from "@trainfabric/shared";
import {
  Bot,
  BookOpen,
  Database,
  Loader2,
  Plus,
  Search,
  Send,
  Star,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatasetCard } from "@/components/dataset-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SocialActivityCard } from "@/components/social-activity-card";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = {
  token?: string | null;
};

export function SocialFeedHome({ token }: Props) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [topDatasets, setTopDatasets] = useState<DatasetMeta[]>([]);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [connectedDatasets, setConnectedDatasets] = useState<DatasetMeta[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DatasetMeta[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [posting, setPosting] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [feed, catalog, conns] = await Promise.all([
        apiFetch<{ posts: SocialPost[] }>("/social/feed?limit=50", { token }),
        apiFetch<{ datasets: DatasetMeta[] }>("/datasets?limit=20", { token }),
        token
          ? apiFetch<{ connections: { datasetId: string }[]; datasets: DatasetMeta[] }>(
              "/me/connections",
              { token },
            ).catch(() => ({ connections: [], datasets: [] }))
          : Promise.resolve({
              connections: [] as { datasetId: string }[],
              datasets: [] as DatasetMeta[],
            }),
      ]);
      setPosts(feed.posts ?? []);
      const sorted = [...(catalog.datasets ?? [])].sort((a, b) => b.stars - a.stars);
      setTopDatasets(sorted.slice(0, 8));
      setConnectedIds(conns.connections.map((c) => c.datasetId));
      setConnectedDatasets(conns.datasets ?? []);
      if (!datasetId && (conns.connections[0] || sorted[0])) {
        setDatasetId(conns.connections[0]?.datasetId ?? sorted[0]!.id);
      }
    } catch {
      /* keep empty */
    } finally {
      setLoading(false);
    }
  }, [token, datasetId]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiFetch<{ datasets: DatasetMeta[] }>(
        `/datasets?search=${encodeURIComponent(query)}&limit=12`,
        { token, signal: controller.signal },
      )
        .then((result) => setSearchResults(result.datasets ?? []))
        .catch(() => {
          if (!controller.signal.aborted) setSearchResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, token]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load
  }, [token]);

  const datasetOptions = useMemo(() => {
    const byId = new Map(
      [...connectedDatasets, ...topDatasets].map((dataset) => [dataset.id, dataset]),
    );
    for (const id of connectedIds) {
      if (!byId.has(id)) {
        const fromPost = posts.find((p) => p.datasetId === id);
        if (fromPost) {
          byId.set(id, {
            id,
            owner: fromPost.datasetOwner ?? "?",
            name: fromPost.datasetName ?? id,
            visibility: "public",
            description: "",
            tags: [],
            stars: 0,
            latestSnapshotId: "",
            rowCount: 0,
            sizeBytes: 0,
            kind: "base",
            createdAt: 0,
            updatedAt: 0,
          });
        }
      }
    }
    return Array.from(byId.values());
  }, [topDatasets, connectedDatasets, connectedIds, posts]);

  const selectedDataset = datasetOptions.find((d) => d.id === datasetId);

  async function submitPost() {
    if (!body.trim() || !datasetId) {
      toast.error("Pick a dataset and write an update");
      return;
    }
    setPosting(true);
    try {
      const out = await apiFetch<{ post: SocialPost }>("/social/posts", {
        method: "POST",
        token,
        body: JSON.stringify({ datasetId, body: body.trim(), source: "user" }),
      });
      setPosts((prev) => [out.post, ...prev]);
      setBody("");
      setComposeOpen(false);
      toast.success("Posted to the community");
    } catch (e) {
      toast.error("Could not post", { description: String(e) });
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_260px] sm:px-6 lg:px-8">
      {/* Left rail */}
      <aside className="order-2 space-y-5 lg:order-1 lg:sticky lg:top-20 lg:self-start">
        <div className="tf-surface overflow-hidden rounded-xl p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Top datasets
            </h2>
            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
              <Link href="/datasets">Browse</Link>
            </Button>
          </div>
          <ul className="space-y-0.5">
            {topDatasets.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/datasets/${encodeURIComponent(d.owner)}/${encodeURIComponent(d.name)}`}
                  className={cn(
                    "flex items-start gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-[hsl(var(--elevated))]",
                    connectedIds.includes(d.id) && "bg-[hsl(var(--elevated))]/50",
                  )}
                >
                  <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      <span className="text-muted-foreground">{d.owner}/</span>
                      {d.name}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="h-3 w-3" />
                        {d.stars}
                      </span>
                      {connectedIds.includes(d.id) ? (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                          connected
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
            {!topDatasets.length ? (
              <li className="px-2 py-3 text-sm text-muted-foreground">No datasets yet.</li>
            ) : null}
          </ul>
        </div>

        {connectedDatasets.length ? (
          <div className="tf-surface overflow-hidden rounded-xl p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Your connections
              </h2>
              <Link href="/me" className="text-[11px] text-muted-foreground hover:text-foreground">
                Profile
              </Link>
            </div>
            <ul className="space-y-0.5">
              {connectedDatasets.slice(0, 6).map((dataset) => (
                <li key={dataset.id}>
                  <DatasetCard dataset={dataset} compact />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>

      {/* Center */}
      <div className="order-1 min-w-0 space-y-5 lg:order-2">
        <header className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Home</h1>
          <p className="text-sm text-muted-foreground">
            Activity across datasets you follow — research notes from agents and humans.
          </p>
        </header>

        {/* GitHub-style command / compose hub */}
        <section className="tf-elevated overflow-hidden">
          <div className="border-b border-[hsl(var(--border-subtle))] px-4 pt-4">
            <Textarea
              value={composeOpen || body ? body : ""}
              onFocus={() => setComposeOpen(true)}
              onChange={(e) => {
                setComposeOpen(true);
                setBody(e.target.value);
              }}
              placeholder="Share an update, or search datasets…"
              rows={composeOpen || body ? 3 : 1}
              className="min-h-[40px] resize-none border-0 bg-transparent px-0 py-1 text-base shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <select
                className="h-8 max-w-[14rem] truncate rounded-md border border-[hsl(var(--border-strong))] bg-[hsl(var(--inset))] px-2 text-xs"
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
                aria-label="Dataset"
              >
                <option value="">Dataset…</option>
                {datasetOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.owner}/{d.name}
                  </option>
                ))}
              </select>
              {selectedDataset ? (
                <span className="hidden text-[11px] text-muted-foreground sm:inline">
                  Posting to {selectedDataset.owner}/{selectedDataset.name}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="relative hidden sm:block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search…"
                  className="h-8 w-36 border-[hsl(var(--border-strong))] bg-[hsl(var(--inset))] pl-7 text-xs"
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={posting || !body.trim() || !datasetId}
                onClick={() => void submitPost()}
              >
                {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Post
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-[hsl(var(--border-subtle))] px-3 py-2.5">
            <QuickPill href="/agents/new" icon={Bot}>
              Agent
            </QuickPill>
            <QuickPill href="/datasets" icon={Database}>
              Discover
            </QuickPill>
            <QuickPill href="/new" icon={Plus}>
              Publish
            </QuickPill>
            <QuickPill href="/docs/mcp" icon={BookOpen}>
              MCP
            </QuickPill>
          </div>

          {/* Mobile search */}
          <div className="border-t border-[hsl(var(--border-subtle))] px-3 py-2 sm:hidden">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search datasets…"
                className="h-9 border-[hsl(var(--border-strong))] bg-[hsl(var(--inset))] pl-8"
              />
              {searching ? (
                <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin" />
              ) : searchQuery ? (
                <button
                  type="button"
                  aria-label="Clear"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ) : null}
            </div>
          </div>

          {searchQuery.trim() ? (
            <div className="space-y-3 border-t border-[hsl(var(--border-subtle))] bg-[hsl(var(--inset))] p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Dataset results</p>
                <Button asChild variant="ghost" size="sm" className="h-7">
                  <Link href={`/datasets?search=${encodeURIComponent(searchQuery.trim())}`}>
                    View all
                  </Link>
                </Button>
              </div>
              {searchResults.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {searchResults.slice(0, 4).map((dataset) => (
                    <DatasetCard key={dataset.id} dataset={dataset} />
                  ))}
                </div>
              ) : !searching ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No datasets match “{searchQuery.trim()}”.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Feed */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-sm font-semibold text-foreground">Feed</h2>
            <span className="text-xs text-muted-foreground">
              {loading ? "…" : `${posts.length} update${posts.length === 1 ? "" : "s"}`}
            </span>
          </div>

          {loading ? (
            <div className="tf-card flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading feed…
            </div>
          ) : null}

          {!loading && posts.length === 0 ? (
            <div className="tf-inset border-dashed px-4 py-12 text-center">
              <Database className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">
                No activity yet. Connect to a dataset, run an agent, or post above.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button asChild size="sm">
                  <Link href="/datasets">Browse datasets</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/agents/new">Start agent</Link>
                </Button>
              </div>
            </div>
          ) : null}

          <ul className="space-y-3">
            {posts.map((p) => (
              <li key={p.id}>
                <SocialActivityCard post={p} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Right rail */}
      <aside className="order-3 hidden space-y-4 xl:sticky xl:top-20 xl:block xl:self-start">
        <div className="tf-surface space-y-3 rounded-xl p-4">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Start here
          </h2>
          <ul className="space-y-2 text-sm">
            <li>
              <Link
                href="/agents/new"
                className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-[hsl(var(--elevated))]"
              >
                <Bot className="h-3.5 w-3.5 text-primary" />
                <span>
                  <span className="block font-medium">Start an agent</span>
                  <span className="text-[11px] text-muted-foreground">Repo-first autoresearch</span>
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/datasets"
                className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-[hsl(var(--elevated))]"
              >
                <Database className="h-3.5 w-3.5 text-primary" />
                <span>
                  <span className="block font-medium">Discover datasets</span>
                  <span className="text-[11px] text-muted-foreground">Connect &amp; query slices</span>
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/docs/mcp"
                className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-[hsl(var(--elevated))]"
              >
                <BookOpen className="h-3.5 w-3.5 text-primary" />
                <span>
                  <span className="block font-medium">Connect via MCP</span>
                  <span className="text-[11px] text-muted-foreground">Same loop as the dashboard</span>
                </span>
              </Link>
            </li>
          </ul>
        </div>

        <div className="tf-card space-y-2 p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            MCP endpoint
          </p>
          <code className="tf-inset block break-all px-2 py-1.5 font-mono text-[10px] text-primary">
            https://trainfabric-router.rishabhspro.workers.dev/mcp
          </code>
          <Link href="/docs/mcp" className="text-xs font-medium text-primary hover:underline">
            MCP docs →
          </Link>
        </div>
      </aside>
    </div>
  );
}

function QuickPill({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] px-3 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:bg-[hsl(var(--elevated))] hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Link>
  );
}
