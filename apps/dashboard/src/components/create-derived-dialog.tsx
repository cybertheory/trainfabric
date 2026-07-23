"use client";

import { useState } from "react";
import type { DatasetMeta } from "@trainfabric/shared";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { HelpCircle } from "lucide-react";

export function CreateDerivedDialog({ source }: { source: DatasetMeta }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${source.name}-slice`);
  const [filter, setFilter] = useState("");
  const [combine, setCombine] = useState("single");
  const [mat, setMat] = useState("auto");
  const [preview, setPreview] = useState<unknown>(null);

  async function dryRun() {
    const spec = {
      sources: [
        {
          datasetId: source.id,
          query: { datasetId: source.id, filter: filter || undefined },
        },
      ],
      combine: { op: combine },
      materialization: mat,
      followLatest: true,
    };
    try {
      const res = await apiFetch("/mcp", {
        method: "POST",
        body: JSON.stringify({ method: "preview_derived", params: { spec } }),
      });
      setPreview(res);
      toast.message("Preview ready");
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function create() {
    try {
      const res = await apiFetch<{
        datasetId: string;
        materialization: { mode: string; reason: string };
      }>("/datasets/derived", {
        method: "POST",
        body: JSON.stringify({
          name,
          visibility: "private",
          tags: ["derived"],
          spec: {
            sources: [
              {
                datasetId: source.id,
                query: { datasetId: source.id, filter: filter || undefined },
              },
            ],
            combine: { op: combine },
            materialization: mat,
            followLatest: true,
          },
        }),
      });
      toast.success(`Created ${res.datasetId} as ${res.materialization.mode}`);
      setOpen(false);
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Create derived
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create derived dataset</DialogTitle>
          <DialogDescription>
            Define a view or materialized slice over <code>{source.name}</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <Textarea
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Source filter (optional)"
          />
          <div className="grid grid-cols-2 gap-3">
            <Select value={combine} onValueChange={setCombine}>
              <SelectTrigger>
                <SelectValue placeholder="Combine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">single</SelectItem>
                <SelectItem value="union">union</SelectItem>
                <SelectItem value="join">join</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Select value={mat} onValueChange={setMat}>
                <SelectTrigger>
                  <SelectValue placeholder="Materialization" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto</SelectItem>
                  <SelectItem value="pointer">pointer</SelectItem>
                  <SelectItem value="materialized">materialized</SelectItem>
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Auto picks pointer for Case-A-cheap specs (no duplication) and materialize for Case-B
                  joins/filters.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          {preview ? (
            <pre className="max-h-40 overflow-auto rounded border bg-muted/40 p-2 text-xs">
              {JSON.stringify(preview, null, 2)}
            </pre>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={dryRun}>
              Preview
            </Button>
            <Button onClick={create}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
