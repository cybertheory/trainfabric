"use client";

import Link from "next/link";
import type { SocialPost } from "@trainfabric/shared";
import { Bot, MessageSquare, MoreHorizontal, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShareToXButton } from "@/components/share-to-x";
import { AuthorAvatar } from "@/components/author-avatar";
import { cn } from "@/lib/utils";

export function timeAgoLabel(ts: number) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"} ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function postTitle(body: string, source: SocialPost["source"]) {
  const line = body.trim().split(/\n/)[0]?.trim() || "";
  if (!line) return source === "agent" ? "Agent research update" : "Community update";
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

function postExcerpt(body: string, title: string) {
  const rest = body.trim();
  const first = rest.split(/\n/)[0]?.trim() ?? "";
  const titleBase = title.replace(/…$/, "");
  if (first === title || first.startsWith(titleBase)) {
    return rest.split(/\n/).slice(1).join("\n").trim();
  }
  if (rest === title) return "";
  return rest;
}

export function SocialActivityCard({
  post,
  className,
}: {
  post: SocialPost;
  className?: string;
}) {
  const label =
    post.datasetOwner && post.datasetName
      ? `${post.datasetOwner}/${post.datasetName}`
      : post.datasetId;
  const datasetHref =
    post.datasetOwner && post.datasetName
      ? `/datasets/${encodeURIComponent(post.datasetOwner)}/${encodeURIComponent(post.datasetName)}`
      : "/datasets";
  const authorLabel = post.authorName || post.authorUsername || post.authorId.slice(0, 12);
  const isAgent = post.authorIsAgent ?? post.source === "agent";
  const title = postTitle(post.body, post.source);
  const excerpt = postExcerpt(post.body, title);
  const verb = isAgent ? "contributed to" : "posted to";

  return (
    <article
      className={cn(
        "tf-card overflow-hidden p-4 sm:p-5",
        className,
      )}
    >
      {/* Header — avatar + activity sentence + time */}
      <div className="flex items-start gap-3">
        <AuthorAvatar
          name={post.authorName}
          imageUrl={post.authorImage}
          isAgent={isAgent}
          size={32}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm leading-snug text-muted-foreground">
              <span className="font-semibold text-foreground">{authorLabel}</span>
              {" "}
              {verb}{" "}
              <Link href={datasetHref} className="font-semibold text-foreground hover:text-primary hover:underline">
                {label}
              </Link>
              <span className="mx-1.5 text-muted-foreground/80">·</span>
              <Link
                href={`/posts/${post.id}`}
                className="hover:underline"
                title={new Date(post.createdAt).toLocaleString()}
              >
                {timeAgoLabel(post.createdAt)}
              </Link>
            </p>
            <Button asChild variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground">
              <Link href={`/posts/${post.id}`} aria-label="Open post">
                <MoreHorizontal className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* Title + badge */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href={`/posts/${post.id}`}
              className="text-base font-semibold tracking-tight text-foreground hover:text-primary hover:underline sm:text-lg"
            >
              {title}
            </Link>
            {isAgent ? (
              <Badge
                variant="secondary"
                className="gap-1 border border-primary/25 bg-primary/10 font-normal text-primary"
              >
                <Bot className="h-3 w-3" />
                Agent
              </Badge>
            ) : (
              <Badge
                variant="secondary"
                className="gap-1 border border-[hsl(var(--border-strong))] bg-[hsl(var(--elevated))] font-normal"
              >
                <Sparkles className="h-3 w-3" />
                Update
              </Badge>
            )}
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            {authorLabel} {isAgent ? "shared findings" : "shared an update"} on{" "}
            <Link href={datasetHref} className="hover:underline">
              {label}
            </Link>
          </p>

          {/* Inset summary box */}
          <div className="tf-inset mt-3 space-y-2 p-3 text-sm leading-relaxed text-muted-foreground">
            {excerpt ? (
              <p className="whitespace-pre-wrap text-foreground/90">{excerpt}</p>
            ) : (
              <p className="whitespace-pre-wrap text-foreground/90">{post.body.trim()}</p>
            )}
            {post.findings ? (
              <pre className="overflow-x-auto rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--canvas))] p-2 font-mono text-[11px] text-muted-foreground">
                {JSON.stringify(post.findings, null, 2)}
              </pre>
            ) : null}
            <p className="text-xs">
              On{" "}
              <Link href={datasetHref} className="font-medium text-primary hover:underline">
                {label}
              </Link>
            </p>
          </div>

          {/* Footer — reactions / comments vibe */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <ShareToXButton
                postId={post.id}
                body={post.body}
                datasetLabel={label}
                size="sm"
                variant="ghost"
              />
            </div>
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground">
              <Link href={`/posts/${post.id}`}>
                <MessageSquare className="h-3.5 w-3.5" />
                Open
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
