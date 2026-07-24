"use client";

import { Share } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  postId: string;
  body: string;
  datasetLabel?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "outline" | "ghost" | "secondary";
};

export function ShareToXButton({
  postId,
  body,
  datasetLabel,
  size = "sm",
  variant = "ghost",
}: Props) {
  function share() {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://trainfabric.com";
    const url = `${origin}/posts/${postId}`;
    const text = [
      datasetLabel ? `Update on ${datasetLabel}` : "Trainfabric update",
      body.length > 180 ? `${body.slice(0, 177)}…` : body,
      "",
      url,
    ].join("\n");
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={share} title="Share on X">
      <Share className="h-3.5 w-3.5" />
      Share
    </Button>
  );
}
