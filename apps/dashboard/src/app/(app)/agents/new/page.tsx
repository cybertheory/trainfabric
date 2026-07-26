"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AutoRun, DatasetMeta } from "@trainfabric/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";
import { cn } from "@/lib/utils";

const STEPS = ["Goal", "Repo & protocol", "Compute", "Review"] as const;

type Prereq = {
  boxConfigured: boolean;
  modalConfigured: boolean;
  note: string;
};

export default function NewAgentPage() {
  return (
    <Suspense fallback={null}>
      <NewAgentWizard />
    </Suspense>
  );
}

function NewAgentWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { trackAutoRun } = useJobTracker();
  const [step, setStep] = useState(0);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [prereq, setPrereq] = useState<Prereq | null>(null);
  const [starting, setStarting] = useState(false);

  const [goal, setGoal] = useState("");
  const [datasetHint, setDatasetHint] = useState(searchParams.get("dataset") ?? ""); // optional — "" means agent chooses
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

  useEffect(() => {
    Promise.all([
      apiFetch<{ datasets: DatasetMeta[] }>("/datasets").catch(() => ({ datasets: [] })),
      apiFetch<{ prerequisites?: Prereq }>("/auto").catch(() => ({ prerequisites: undefined })),
    ]).then(([ds, auto]) => {
      setDatasets(ds.datasets ?? []);
      if (auto.prerequisites) setPrereq(auto.prerequisites);
    });
  }, []);

  const selectedHint = useMemo(
    () => datasets.find((d) => d.id === datasetHint) ?? null,
    [datasets, datasetHint],
  );

  function canNext(): boolean {
    if (step === 0) return goal.trim().length >= 8;
    if (step === 1) {
      return (
        Boolean(repoUrl.trim()) &&
        Boolean(metric.trim()) &&
        mutablePaths.split(",").some((s) => s.trim()) &&
        Number(maxTrials) >= 1
      );
    }
    if (step === 2) {
      if (provider === "modal") return true;
      return Boolean(runnerId.trim());
    }
    return true;
  }

  async function start() {
    setStarting(true);
    try {
      const run = await apiFetch<AutoRun>(`/auto`, {
        method: "POST",
        body: JSON.stringify({
          goal: goal.trim(),
          repoUrl: repoUrl.trim(),
          defaultBranch: branch.trim() || "main",
          datasetId: datasetHint || undefined,
          protocol: {
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
      trackAutoRun({
        autoRunId: run.id,
        datasetId: run.datasetId,
        name: `Auto · ${repoUrl.split("/").slice(-2).join("/") || goal.slice(0, 24)}`,
      });
      toast.success("Agent started", {
        description: datasetHint
          ? "Starting trials on your dataset hint."
          : "The agent will discover and bind a dataset for your goal.",
      });
      router.push(`/auto/${run.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start agent");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-1 py-2">
      <div className="space-y-2">
        <Link
          href="/agents"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Agents
        </Link>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Configure agent</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Set a research <span className="font-medium text-foreground">goal</span>, bind a repo and
          compute — the agent discovers and binds datasets itself. Nothing runs until you confirm on
          the last step.
        </p>
      </div>

      {prereq ? (
        <div
          className={cn(
            "rounded-lg border px-3 py-2.5 text-xs",
            prereq.boxConfigured
              ? "border-primary/20 bg-primary/5"
              : "border-amber-500/30 bg-amber-500/5",
          )}
        >
          <p className="font-medium">
            {prereq.boxConfigured
              ? "Platform Box API key is configured"
              : "No BOX_API_KEY on the Worker — start uses stub mode"}
          </p>
          <p className="mt-1 text-muted-foreground">
            Box keys are <span className="font-medium text-foreground">not</span> entered here.
            Operators set <code>BOX_API_KEY</code> (and optionally <code>BOX_TEMPLATE_ID</code>) as
            Worker secrets. You configure the goal, repo, protocol, and GPU provider below.
          </p>
        </div>
      ) : null}

      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => {
                if (i < step) setStep(i);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
                i === step
                  ? "border-primary bg-primary/10 text-foreground"
                  : i < step
                    ? "border-border text-foreground"
                    : "border-transparent text-muted-foreground",
              )}
            >
              {i < step ? <Check className="h-3 w-3 text-primary" /> : <span>{i + 1}.</span>}
              {label}
            </button>
          </li>
        ))}
      </ol>

      <div className="min-h-[280px] space-y-4 rounded-lg border p-4">
        {step === 0 ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">1. Research goal</h2>
            <p className="text-xs text-muted-foreground">
              Describe the outcome — the agent uses discovery to find and bind the most relevant
              dataset(s). You don&apos;t need to pick data here.
            </p>
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Lower validation bits-per-byte on multilingual web text by tuning the tokenizer and data mixture."
              className="min-h-[96px]"
            />
            <div className="space-y-1">
              <Label className="text-xs">Dataset hint (optional)</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={datasetHint}
                onChange={(e) => setDatasetHint(e.target.value)}
              >
                <option value="">Let the agent choose (recommended)</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.owner}/{d.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                {selectedHint
                  ? "Starts bound to this dataset; the agent may still bind others."
                  : "The agent runs discover_datasets, then binds the best match (or asks you in chat)."}
              </p>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">2. GitHub repo & protocol</h2>
            <div className="space-y-1">
              <Label className="text-xs">Repo URL</Label>
              <Input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/org/autoresearch-repo"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Branch</Label>
                <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Metric name</Label>
                <Input value={metric} onChange={(e) => setMetric(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Direction</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as "min" | "max")}
                >
                  <option value="min">min (lower better)</option>
                  <option value="max">max (higher better)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max trials</Label>
                <Input
                  type="number"
                  value={maxTrials}
                  onChange={(e) => setMaxTrials(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Wall clock (sec)</Label>
                <Input
                  type="number"
                  value={wallSec}
                  onChange={(e) => setWallSec(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mutable paths (agent may edit)</Label>
              <Input value={mutablePaths} onChange={(e) => setMutablePaths(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Immutable paths (eval — agent cannot soften)</Label>
              <Textarea
                value={immutablePaths}
                onChange={(e) => setImmutablePaths(e.target.value)}
                className="min-h-[64px]"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              The dataset snapshot is frozen into the protocol when the agent binds a dataset, so
              trials stay comparable.
            </p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">3. GPU compute</h2>
            <p className="text-xs text-muted-foreground">
              The long agent runs on Box (platform key). Trials train/eval on Modal or your HTTP
              runner image — not inside the DuckDB compute container.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Provider</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={provider}
                onChange={(e) => setProvider(e.target.value as "modal" | "runner")}
              >
                <option value="modal">Modal (managed)</option>
                <option value="runner">Self-hosted HTTP runner</option>
              </select>
            </div>
            {provider === "modal" ? (
              <div className="space-y-1">
                <Label className="text-xs">Modal app/function ref (optional override)</Label>
                <Input
                  value={modalRef}
                  onChange={(e) => setModalRef(e.target.value)}
                  placeholder="username/trainfabric-trial"
                />
                <p className="text-[11px] text-muted-foreground">
                  Account token lives in Worker secret <code>MODAL_TOKEN</code>
                  {prereq?.modalConfigured ? " (set)." : " (not set yet — trials queue locally)."}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">Runner id</Label>
                <Input
                  value={runnerId}
                  onChange={(e) => setRunnerId(e.target.value)}
                  placeholder="runner_…"
                />
                <p className="text-[11px] text-muted-foreground">
                  Register with <code>POST /runners/register</code>, then run{" "}
                  <code>trainfabric/gpu-runner</code> with the returned token.
                </p>
              </div>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">4. Review & start</h2>
            <dl className="space-y-2 rounded-md bg-muted/30 p-3 text-xs">
              <Row k="Goal" v={goal} />
              <Row
                k="Dataset"
                v={
                  selectedHint
                    ? `${selectedHint.owner}/${selectedHint.name} (hint)`
                    : "Agent chooses at runtime"
                }
              />
              <Row k="Repo" v={`${repoUrl} @ ${branch}`} />
              <Row k="Metric" v={`${metric} · ${direction}`} />
              <Row k="Budget" v={`${maxTrials} trials · ${wallSec}s`} />
              <Row k="Mutable" v={mutablePaths} />
              <Row k="Immutable" v={immutablePaths} />
              <Row
                k="Compute"
                v={
                  provider === "modal"
                    ? `modal${modalRef ? ` · ${modalRef}` : ""}`
                    : `runner · ${runnerId}`
                }
              />
              <Row
                k="Box"
                v={
                  prereq?.boxConfigured
                    ? "Live sandbox (BOX_API_KEY set)"
                    : "Stub mode until BOX_API_KEY is set on Worker"
                }
              />
            </dl>
            <p className="text-xs text-muted-foreground">
              Starting creates an AutoRun, provisions Box when configured, and opens the live
              monitor + chat. You can steer, pause, or cancel anytime.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={step === 0 || starting}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" disabled={!canNext()} onClick={() => setStep((s) => s + 1)}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" disabled={starting || !canNext()} onClick={() => void start()}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            {starting ? "Starting…" : "Start agent"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-all font-medium">{v}</dd>
    </div>
  );
}
