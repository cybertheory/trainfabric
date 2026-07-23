"use client";

import Link from "next/link";
import type { DatasetMeta } from "@trainfabric/shared";
import { Star } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatRows } from "@/lib/utils";

export function DatasetCard({ dataset }: { dataset: DatasetMeta }) {
  const href = `/datasets/${encodeURIComponent(dataset.owner)}/${encodeURIComponent(dataset.name)}`;
  return (
    <Link href={href} className="block h-full">
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base">{dataset.name}</CardTitle>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="h-3.5 w-3.5" />
              {dataset.stars}
            </div>
          </div>
          <CardDescription className="line-clamp-2">
            {dataset.description || "No description"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline">{dataset.visibility}</Badge>
            {dataset.kind === "derived" ? <Badge variant="secondary">derived</Badge> : null}
            {dataset.tags.slice(0, 4).map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>{formatRows(dataset.rowCount)} rows</span>
            <span>{formatBytes(dataset.sizeBytes)}</span>
            <span className="truncate">{dataset.owner}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
