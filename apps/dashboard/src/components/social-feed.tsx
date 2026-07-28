"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AppNotification, DatasetMeta, SocialPost } from "@trainfabric/shared";
import { BookOpen, Bot, Database, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatasetCard } from "@/components/dataset-card";
import { Badge } from "@/components/ui/badge";
import { SocialActivityCard, timeAgoLabel } from "@/components/social-activity-card";
import { TrainfabricAgentBox } from "@/components/trainfabric-agent-box";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type FeedItem =
  | { type: "post"; key: string; at: number; post: SocialPost }
  | { type: "notification"; key: string; at: number; notification: AppNotification };

export function SocialFeedHome({
  token,
  getToken,
}: {
  token?: string | null;
  getToken?: () => Promise<string | null>;
}) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [topDatasets, setTopDatasets] = useState<DatasetMeta[]>([]);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [connectedDatasets, setConnectedDatasets] = useState<DatasetMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [feed, catalog, conns, notifs] = await Promise.all([
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
        token
          ? apiFetch<{ notifications: AppNotification[] }>("/notifications?limit=40", {
              token,
            }).catch(() => ({ notifications: [] }))
          : Promise.resolve({ notifications: [] as AppNotification[] }),
      ]);
      setPosts(feed.posts ?? []);
      const sorted = [...(catalog.datasets ?? [])].sort(
        (a, b) => b.connections - a.connections,
      );
      setTopDatasets(sorted.slice(0, 8));
      setConnectedIds(conns.connections.map((c) => c.datasetId));
      setConnectedDatasets(conns.datasets ?? []);
      setNotifications(notifs.notifications ?? []);
    } catch {
      /* keep empty */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasConnections = connectedIds.length > 0;

  const feedItems: FeedItem[] = (() => {
    const items: FeedItem[] = [];
    for (const post of posts) {
      items.push({ type: "post", key: `post-${post.id}`, at: post.createdAt, post });
    }
    // Notifications that aren't already represented as posts we have
    const postIds = new Set(posts.map((p) => p.id));
    for (const n of notifications) {
      if (n.postId && postIds.has(n.postId)) continue;
      items.push({
        type: "notification",
        key: `notif-${n.id}`,
        at: n.createdAt,
        notification: n,
      });
    }
    items.sort((a, b) => b.at - a.at);
    return items;
  })();

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_260px] sm:px-6 lg:px-8">
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
                        <Link2 className="h-3 w-3" />
                        {d.connections}
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

      <div className="order-1 min-w-0 space-y-5 lg:order-2">
        <header className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Home</h1>
          <p className="text-sm text-muted-foreground">
            Quick agent for discover / AutoRuns, then activity from datasets you follow.
          </p>
        </header>

        <TrainfabricAgentBox token={token} getToken={getToken} />

        <section className="space-y-3">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-sm font-semibold text-foreground">Activity</h2>
            <span className="text-xs text-muted-foreground">
              {loading
                ? "…"
                : hasConnections
                  ? `${feedItems.length} event${feedItems.length === 1 ? "" : "s"}`
                  : "connected datasets only"}
            </span>
          </div>

          {loading ? (
            <div className="tf-card flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading activity…
            </div>
          ) : null}

          {!loading && !hasConnections ? (
            <div className="tf-inset border-dashed px-4 py-12 text-center">
              <Database className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">
                Connect a dataset to see activity here.
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

          {!loading && hasConnections && feedItems.length === 0 ? (
            <div className="tf-inset border-dashed px-4 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No events yet on your connected datasets.
              </p>
            </div>
          ) : null}

          <ul className="space-y-3">
            {feedItems.map((item) =>
              item.type === "post" ? (
                <li key={item.key}>
                  <SocialActivityCard post={item.post} />
                </li>
              ) : (
                <li key={item.key}>
                  <NotificationEventCard notification={item.notification} />
                </li>
              ),
            )}
          </ul>
        </section>
      </div>

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
                  <span className="text-[11px] text-muted-foreground">Same tools as this agent</span>
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

function NotificationEventCard({ notification }: { notification: AppNotification }) {
  const inner = (
    <article className="tf-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{notification.title}</p>
          {notification.body ? (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{notification.body}</p>
          ) : null}
          <p className="mt-2 text-[11px] text-muted-foreground">
            {notification.kind.replace(/_/g, " ")} · {timeAgoLabel(notification.createdAt)}
            {!notification.read ? " · unread" : ""}
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          event
        </Badge>
      </div>
    </article>
  );
  if (notification.href) {
    return (
      <Link href={notification.href} className="block transition hover:opacity-95">
        {inner}
      </Link>
    );
  }
  return inner;
}
