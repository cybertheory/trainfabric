"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Command } from "cmdk";
import type { DatasetMeta } from "@trainfabric/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function labelOf(d: DatasetMeta): string {
  return `${d.owner}/${d.name}`;
}

export function DatasetMultiSelect({
  datasets,
  value,
  onChange,
}: {
  datasets: DatasetMeta[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => value.map((id) => datasets.find((d) => d.id === id)).filter(Boolean) as DatasetMeta[],
    [datasets, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return datasets;
    return datasets.filter((d) => {
      const hay = `${d.owner}/${d.name} ${d.description ?? ""} ${d.tags.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [datasets, query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  }

  return (
    <div ref={rootRef} className="relative space-y-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((d) => (
            <Badge key={d.id} variant="secondary" className="gap-1 pr-1 font-normal">
              <span className="max-w-[14rem] truncate">{labelOf(d)}</span>
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-muted"
                aria-label={`Remove ${labelOf(d)}`}
                onClick={() => toggle(d.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 w-full justify-between font-normal"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="truncate text-muted-foreground">
          {selected.length
            ? `${selected.length} dataset${selected.length === 1 ? "" : "s"} selected`
            : datasets.length
              ? "Search and select datasets…"
              : "No datasets available"}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </Button>

      {open ? (
        <div className="tf-elevated absolute z-40 mt-1 w-full overflow-hidden shadow-lg">
          <Command shouldFilter={false} className="max-h-64 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[hsl(var(--border-subtle))] px-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search by name, owner, tags…"
                className="flex h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Command.List className="max-h-52 overflow-y-auto p-1">
              <Command.Empty className="px-2 py-6 text-center text-xs text-muted-foreground">
                No datasets match.
              </Command.Empty>
              {filtered.map((d) => {
                const checked = value.includes(d.id);
                return (
                  <Command.Item
                    key={d.id}
                    value={d.id}
                    onSelect={() => toggle(d.id)}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-xs aria-selected:bg-muted",
                      checked && "bg-primary/5",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {checked ? <Check className="h-2.5 w-2.5" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{labelOf(d)}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {d.description?.trim() ||
                          `${d.kind} · ${d.rowCount.toLocaleString()} rows`}
                      </span>
                    </span>
                  </Command.Item>
                );
              })}
            </Command.List>
          </Command>
        </div>
      ) : null}
    </div>
  );
}
