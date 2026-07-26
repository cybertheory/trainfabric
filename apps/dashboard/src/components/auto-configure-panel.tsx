"use client";

import Link from "next/link";
import { Bot, ArrowRight } from "lucide-react";

/**
 * Optional dataset hint for autoresearch. The primary, repo-first path is the
 * wizard at /agents/new — here we only offer "prefer this dataset" so the agent
 * can start bound to it (it still loads goals from the connected Git repo).
 */
export function AutoConfigurePanel({
  datasetId,
  snapshotId,
}: {
  datasetId: string;
  snapshotId?: string;
  token?: string | null;
}) {
  void snapshotId;
  return (
    <section className="space-y-2 rounded-lg border border-border/80 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Bot className="h-4 w-4 text-primary" />
        Autoresearch (/auto)
      </div>
      <p className="text-xs text-muted-foreground">
        Connect a GitHub repo first — goals and instructions live there. You can prefer this dataset
        as a starting hint while the agent loads the repo brief.
      </p>
      <Link
        href={`/agents/new?dataset=${encodeURIComponent(datasetId)}`}
        className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Configure agent with this dataset
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}
