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
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatasetCard } from "@/components/dataset-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ShareToXButton } from "@/components/share-to-x";
import { AuthorAvatar } from "@/components/author-avatar";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = {
  token?: string | null;
};

function timeAgo(ts: number) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

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
      toast.success("Posted to the community");
    } catch (e) {
      toast.error("Could not post", { description: String(e) });
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_260px] sm:px-6 lg:px-8">
      {/* Left — GitHub-style context rail */}
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

      {/* Center — command hub + feed */}
      <div className="order-1 min-w-0 space-y-5 lg:order-2">
        <header className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Home</h1>
          <p className="text-sm text-muted-foreground">
            Updates from datasets you&apos;re connected to — and research findings from agents.
          </p>
        </header>

        {/* Search + quick actions (GitHub-style command surface) */}
        <section className="tf-elevated space-y-3 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search datasets by name, owner, description, or tag…"
              className="h-10 border-[hsl(var(--border-strong))] bg-[hsl(var(--inset))] pl-9 pr-9"
            />
            {searching ? (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : searchQuery ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <QuickPill href="/agents/new" icon={Bot}>
              Start agent
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

          {searchQuery.trim() ? (
            <div className="tf-inset space-y-3 p-3">
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

        {/* Composer */}
        <section className="tf-card space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" />
            Share an update
          </div>
          <select
            className="flex h-9 w-full rounded-md border border-[hsl(var(--border-strong))] bg-[hsl(var(--inset))] px-2 text-sm"
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
          >
            <option value="">Select dataset community…</option>
            {datasetOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.owner}/{d.name}
              </option>
            ))}
          </select>
          <Textarea
            placeholder="What did you find? A schema tip, slice worth sharing, or research note…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="resize-none border-[hsl(var(--border-strong))] bg-[hsl(var(--inset))]"
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={posting || !body.trim()} onClick={submitPost}>
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Post
            </Button>
          </div>
        </section>

        {/* Feed */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Feed
            </h2>
            <span className="text-[11px] text-muted-foreground">
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
                No updates yet. Connect to a dataset, run an agent, or post above.
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
            {posts.map((p) => {
              const label =
                p.datasetOwner && p.datasetName
                  ? `${p.datasetOwner}/${p.datasetName}`
                  : p.datasetId;
              const authorLabel = p.authorName || p.authorId.slice(0, 12);
              return (
                <li key={p.id} className="tf-card space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <AuthorAvatar
                      name={p.authorName}
                      imageUrl={p.authorImage}
                      isAgent={p.authorIsAgent ?? p.source === "agent"}
                      size={28}
                    />
                    <span className="font-medium text-foreground">{authorLabel}</span>
                    {p.authorUsername ? <span>@{p.authorUsername}</span> : null}
                    {p.source === "agent" ? (
                      <Badge variant="secondary" className="gap-1">
                        <Bot className="h-3 w-3" />
                        agent
                      </Badge>
                    ) : null}
                    <span>·</span>
                    <Link
                      href={
                        p.datasetOwner && p.datasetName
                          ? `/datasets/${encodeURIComponent(p.datasetOwner)}/${encodeURIComponent(p.datasetName)}`
                          : "/datasets"
                      }
                      className="font-medium text-primary hover:underline"
                    >
                      {label}
                    </Link>
                    <span>·</span>
                    <Link href={`/posts/${p.id}`} className="hover:underline">
                      {timeAgo(p.createdAt)}
                    </Link>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{p.body}</p>
                  {p.findings ? (
                    <pre className="tf-inset overflow-x-auto p-2 font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(p.findings, null, 2)}
                    </pre>
                  ) : null}
                  <div className="flex items-center gap-1 border-t border-[hsl(var(--border-subtle))] pt-2">
                    <ShareToXButton postId={p.id} body={p.body} datasetLabel={label} />
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/posts/${p.id}`}>Open</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Right — HF/GitHub utility rail */}
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
