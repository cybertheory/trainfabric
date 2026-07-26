"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";

type AutoRun = {
  id: string;
  status: string;
  datasetId: string;
};

export function AutoConfigurePanel({
  datasetId,
  snapshotId,
  token,
}: {
  datasetId: string;
  snapshotId?: string;
  token?: string | null;
}) {
  const { trackAutoRun } = useJobTracker();
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [metric, setMetric] = useState("val_bpb");
  const [direction, setDirection] = useState<"min" | "max">("min");
  const [maxTrials, setMaxTrials] = useState(20);
  const [wallSec, setWallSec] = useState(3600);
  const [mutablePaths, setMutablePaths] = useState("train.py");
  const [immutablePaths, setImmutablePaths] = useState("prepare.py,protocol.yaml");
  const [provider, setProvider] = useState<"modal" | "runner">("modal");
  const [modalRef, setModalRef] = useState("");
  const [runnerId, setRunnerId] = useState("");
  const [starting, setStarting] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  async function start() {
    if (!repoUrl.trim()) {
      toast.error("GitHub repo URL required");
      return;
    }
    if (!snapshotId) {
      toast.error("Dataset needs a snapshot before /auto");
      return;
    }
    setStarting(true);
    try {
      const run = await apiFetch<AutoRun>(`/datasets/${datasetId}/auto`, {
        method: "POST",
        token,
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          defaultBranch: branch.trim() || "main",
          protocol: {
            snapshotId,
            metric: { name: metric.trim() || "score", direction },
            budget: {
              maxTrials: Number(maxTrials) || 10,
              maxWallClockSec: Number(wallSec) || 3600,
            },
            mutablePaths: mutablePaths
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            immutablePaths: immutablePaths
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          },
          compute: {
            provider,
            modalRef: modalRef.trim() || undefined,
            runnerId: runnerId.trim() || undefined,
          },
        }),
      });
      setLastRunId(run.id);
      trackAutoRun({
        autoRunId: run.id,
        datasetId,
        name: `Auto · ${repoUrl.split("/").slice(-2).join("/")}`,
      });
      toast.success("Autoresearch started", { description: run.status });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start /auto");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border/80 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Bot className="h-4 w-4 text-primary" />
        Autoresearch (/auto)
      </div>
      <p className="text-xs text-muted-foreground">
        Long-running campaign on Box. Not started until you configure a repo + protocol below.
        GPU trials go to Modal or a registered HTTP runner.
      </p>

      <div className="space-y-2">
        <div className="space-y-1">
          <Label className="text-xs">GitHub repo URL</Label>
          <Input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/org/autoresearch-repo"
            className="h-8 text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Branch</Label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Metric</Label>
            <Input
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Direction</Label>
            <select
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              value={direction}
              onChange={(e) => setDirection(e.target.value as "min" | "max")}
            >
              <option value="min">min</option>
              <option value="max">max</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max trials</Label>
            <Input
              type="number"
              value={maxTrials}
              onChange={(e) => setMaxTrials(Number(e.target.value))}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Wall sec</Label>
            <Input
              type="number"
              value={wallSec}
              onChange={(e) => setWallSec(Number(e.target.value))}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Mutable paths (comma)</Label>
          <Input
            value={mutablePaths}
            onChange={(e) => setMutablePaths(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Immutable paths (comma)</Label>
          <Textarea
            value={immutablePaths}
            onChange={(e) => setImmutablePaths(e.target.value)}
            className="min-h-[52px] text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">GPU provider</Label>
            <select
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              value={provider}
              onChange={(e) => setProvider(e.target.value as "modal" | "runner")}
            >
              <option value="modal">Modal</option>
              <option value="runner">HTTP runner</option>
            </select>
          </div>
          {provider === "modal" ? (
            <div className="space-y-1">
              <Label className="text-xs">Modal ref</Label>
              <Input
                value={modalRef}
                onChange={(e) => setModalRef(e.target.value)}
                placeholder="user/app"
                className="h-8 text-xs"
              />
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">Runner id</Label>
              <Input
                value={runnerId}
                onChange={(e) => setRunnerId(e.target.value)}
                placeholder="runner_…"
                className="h-8 text-xs"
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={starting} onClick={() => void start()}>
          {starting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {starting ? "Starting…" : "Start /auto"}
        </Button>
        {lastRunId ? (
          <Link href={`/auto/${lastRunId}`} className="text-xs text-primary hover:underline">
            Open monitor →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
