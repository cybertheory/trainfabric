"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DatasetMeta, SocialPost } from "@trainfabric/shared";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ShareToXButton } from "@/components/share-to-x";
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
          ? apiFetch<{ connections: { datasetId: string }[] }>("/me/connections", { token }).catch(
              () => ({ connections: [] }),
            )
          : Promise.resolve({ connections: [] as { datasetId: string }[] }),
      ]);
      setPosts(feed.posts ?? []);
      const sorted = [...(catalog.datasets ?? [])].sort((a, b) => b.stars - a.stars);
      setTopDatasets(sorted.slice(0, 8));
      setConnectedIds(conns.connections.map((c) => c.datasetId));
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
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load
  }, [token]);

  const datasetOptions = useMemo(() => {
    const byId = new Map(topDatasets.map((d) => [d.id, d]));
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
  }, [topDatasets, connectedIds, posts]);

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
    <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Top datasets
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect from{" "}
            <Link href="/datasets" className="underline-offset-2 hover:underline">
              Discover
            </Link>
          </p>
        </div>
        <ul className="space-y-1">
          {topDatasets.map((d) => (
            <li key={d.id}>
              <Link
                href={`/datasets/${encodeURIComponent(d.owner)}/${encodeURIComponent(d.name)}`}
                className={cn(
                  "block rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-muted",
                  connectedIds.includes(d.id) && "bg-muted/60",
                )}
              >
                <div className="truncate font-medium">
                  <span className="text-muted-foreground">{d.owner}/</span>
                  {d.name}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{d.stars} ★</span>
                  {connectedIds.includes(d.id) ? (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      connected
                    </Badge>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
          {!topDatasets.length ? (
            <li className="px-2 text-sm text-muted-foreground">No datasets yet.</li>
          ) : null}
        </ul>
      </aside>

      <div className="min-w-0 space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Home</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Updates from datasets you&apos;re connected to — and research findings from agents.
          </p>
        </div>

        <section className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" />
            Share an update
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="h-9 min-w-[12rem] flex-1 rounded-md border bg-background px-2 text-sm"
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
          </div>
          <Textarea
            placeholder="What did you find? A schema tip, slice worth sharing, or research note…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="resize-none bg-background"
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={posting || !body.trim()} onClick={submitPost}>
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Post
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading feed…
            </div>
          ) : null}
          {!loading && posts.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                No updates yet. Connect to datasets in Discover, query data, or post above.
              </p>
              <Button asChild variant="secondary" size="sm" className="mt-4">
                <Link href="/datasets">Browse Discover</Link>
              </Button>
            </div>
          ) : null}
          <ul className="divide-y divide-border/70 rounded-lg border border-border/80">
            {posts.map((p) => {
              const label =
                p.datasetOwner && p.datasetName
                  ? `${p.datasetOwner}/${p.datasetName}`
                  : p.datasetId;
              return (
                <li key={p.id} className="space-y-2 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {p.source === "agent" ? (
                      <Badge variant="secondary" className="gap-1">
                        <Bot className="h-3 w-3" />
                        agent
                      </Badge>
                    ) : null}
                    <span className="font-medium text-foreground">
                      {p.authorName || p.authorId.slice(0, 12)}
                    </span>
                    <span>·</span>
                    <Link
                      href={
                        p.datasetOwner && p.datasetName
                          ? `/datasets/${encodeURIComponent(p.datasetOwner)}/${encodeURIComponent(p.datasetName)}`
                          : "/datasets"
                      }
                      className="hover:underline"
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
                    <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(p.findings, null, 2)}
                    </pre>
                  ) : null}
                  <div className="flex items-center gap-1">
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
    </div>
  );
}
