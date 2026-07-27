"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { SocialPost } from "@trainfabric/shared";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SocialActivityCard } from "@/components/social-activity-card";
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
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted-foreground">Post not found.</p>
        <Button asChild variant="secondary" size="sm" className="mt-4">
          <Link href="/home">Back to feed</Link>
        </Button>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8 sm:px-6">
      <Link href="/home" className="text-xs text-muted-foreground hover:text-foreground">
        ← Feed
      </Link>
      <SocialActivityCard post={post} />
    </div>
  );
}
