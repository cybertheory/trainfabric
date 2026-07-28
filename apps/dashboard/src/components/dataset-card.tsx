"use client";

import Link from "next/link";
import type { DatasetMeta } from "@trainfabric/shared";
import { Database, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatBytes, formatRows } from "@/lib/utils";

export function DatasetCard({
  dataset,
  compact = false,
  className,
}: {
  dataset: DatasetMeta;
  compact?: boolean;
  className?: string;
}) {
  const href = `/datasets/${encodeURIComponent(dataset.owner)}/${encodeURIComponent(dataset.name)}`;

  if (compact) {
    return (
      <Link
        href={href}
        className={cn(
          "group flex items-start gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-[hsl(var(--elevated))]",
          className,
        )}
      >
        <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            <span className="text-muted-foreground">{dataset.owner}/</span>
            {dataset.name}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-0.5">
              <Link2 className="h-3 w-3" />
              {dataset.connections}
            </span>
            <span>{formatRows(dataset.rowCount)}</span>
          </p>
        </div>
      </Link>
    );
  }

  return (
    <Link href={href} className={cn("block h-full", className)}>
      <article className="tf-card group flex h-full flex-col p-4 transition-colors hover:border-primary/40 hover:bg-[hsl(var(--elevated))]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--inset))]">
              <Database className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold tracking-tight">
                <span className="font-normal text-muted-foreground">{dataset.owner}/</span>
                {dataset.name}
              </h3>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {dataset.description?.trim() || "Iceberg dataset — open to inspect schema and slices."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="Connections">
            <Link2 className="h-3.5 w-3.5" />
            {dataset.connections}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[10px] font-normal">
            {dataset.visibility}
          </Badge>
          {dataset.kind === "derived" ? (
            <Badge variant="secondary" className="text-[10px] font-normal">
              derived
            </Badge>
          ) : null}
          {dataset.tags.slice(0, 3).map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px] font-normal">
              {t}
            </Badge>
          ))}
        </div>

        <div className="mt-auto flex gap-3 border-t border-[hsl(var(--border-subtle))] pt-3 text-[11px] text-muted-foreground">
          <span>{formatRows(dataset.rowCount)} rows</span>
          <span>{formatBytes(dataset.sizeBytes)}</span>
          {dataset.updatedAt ? (
            <span className="ml-auto truncate">
              updated {new Date(dataset.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          ) : null}
        </div>
      </article>
    </Link>
  );
}
