"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { SocialPost } from "@trainfabric/shared";
import { Bot, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShareToXButton } from "@/components/share-to-x";
import { apiFetch } from "@/lib/api";

export default function PostPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ? decodeURIComponent(params.id) : "";
  const [post, setPost] = useState<SocialPost | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiFetch<{ post: SocialPost }>(`/social/posts/${id}`)
      .then((r) => setPost(r.post))
      .catch(() => setError(true));
  }, [id]);

  if (error) {
    return <p className="text-muted-foreground">Post not found.</p>;
  }
  if (!post) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  const label =
    post.datasetOwner && post.datasetName
      ? `${post.datasetOwner}/${post.datasetName}`
      : post.datasetId;

  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {post.source === "agent" ? (
          <Badge variant="secondary" className="gap-1">
            <Bot className="h-3 w-3" />
            agent
          </Badge>
        ) : null}
        <span className="font-medium text-foreground">
          {post.authorName || post.authorId.slice(0, 16)}
        </span>
        <span>·</span>
        <Link
          href={
            post.datasetOwner && post.datasetName
              ? `/datasets/${encodeURIComponent(post.datasetOwner)}/${encodeURIComponent(post.datasetName)}`
              : "/datasets"
          }
          className="hover:underline"
        >
          {label}
        </Link>
        <span>·</span>
        <time dateTime={new Date(post.createdAt).toISOString()}>
          {new Date(post.createdAt).toLocaleString()}
        </time>
      </div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Community update</h1>
      <p className="whitespace-pre-wrap text-base leading-relaxed">{post.body}</p>
      {post.findings ? (
        <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs">
          {JSON.stringify(post.findings, null, 2)}
        </pre>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <ShareToXButton postId={post.id} body={post.body} datasetLabel={label} variant="outline" />
        <Button asChild variant="secondary" size="sm">
          <Link href="/home">Back to feed</Link>
        </Button>
      </div>
    </article>
  );
}
