"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Github,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AutoRun,
  CreateGithubRepoResponse,
  DatasetMeta,
  GithubConnectionStatus,
} from "@trainfabric/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";
import { cn } from "@/lib/utils";
import { DatasetMultiSelect } from "@/components/dataset-multi-select";

const DEFAULT_PROTOCOL = {
  metric: { name: "val_bpb", direction: "min" as const },
  budget: { maxTrials: 20, maxWallClockSec: 3600 },
  mutablePaths: ["train.py"],
  immutablePaths: ["prepare.py", "protocol.yaml"],
};

type StepId = "connect" | "repo" | "goal" | "data" | "launch";

type BriefProbe = {
  present: boolean;
  sourceFile?: string;
  preview?: string;
  isPlaceholder?: boolean;
};

type GhInstall = {
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  accountId: number;
  avatarUrl?: string;
};

type GhRepo = {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  description?: string | null;
};

function isLikelyGitUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (/^git@[\w.-]+:[\w./-]+(\.git)?$/.test(u)) return true;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "ssh:";
  } catch {
    return false;
  }
}

function repoShortName(url: string): string {
  return (
    url.trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "") || url
  );
}

function parseOwnerRepo(fullOrUrl: string): { owner: string; repo: string } | null {
  const short = repoShortName(fullOrUrl);
  const m = short.match(/^([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export default function NewAgentPage() {
  return (
    <Suspense fallback={null}>
      <AgentStartCoach />
    </Suspense>
  );
}

function AgentStartCoach() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { trackAutoRun, authToken } = useJobTracker();
  const [stepIdx, setStepIdx] = useState(0);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [starting, setStarting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [repoMode, setRepoMode] = useState<"pick" | "create" | "url">("pick");
  const [ghStatus, setGhStatus] = useState<GithubConnectionStatus | null>(null);
  const [ghInstalls, setGhInstalls] = useState<GhInstall[]>([]);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [ghRepos, setGhRepos] = useState<GhRepo[]>([]);
  const [repoSelection, setRepoSelection] = useState<"all" | "selected" | undefined>();
  const [repoTotalCount, setRepoTotalCount] = useState<number | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedFullName, setSelectedFullName] = useState("");
  const [githubRepoId, setGithubRepoId] = useState<number | undefined>();
  const [createdFromPlatform, setCreatedFromPlatform] = useState(false);
  const [ghLoading, setGhLoading] = useState(false);
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [newRepoDesc, setNewRepoDesc] = useState("");
  const [connectingGh, setConnectingGh] = useState(false);
  const initialDataset = searchParams.get("dataset");
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>(
    initialDataset ? [initialDataset] : [],
  );

  const [goal, setGoal] = useState("");
  const [briefProbe, setBriefProbe] = useState<BriefProbe | null>(null);
  const [briefChecking, setBriefChecking] = useState(false);
  const [enriching, setEnriching] = useState(false);

  const [metric, setMetric] = useState(DEFAULT_PROTOCOL.metric.name);
  const [direction, setDirection] = useState<"min" | "max">(DEFAULT_PROTOCOL.metric.direction);
  const [maxTrials, setMaxTrials] = useState(DEFAULT_PROTOCOL.budget.maxTrials);
  const [wallSec, setWallSec] = useState(DEFAULT_PROTOCOL.budget.maxWallClockSec);
  const [mutablePaths, setMutablePaths] = useState(DEFAULT_PROTOCOL.mutablePaths.join(", "));
  const [immutablePaths, setImmutablePaths] = useState(
    DEFAULT_PROTOCOL.immutablePaths.join(", "),
  );
  const [provider, setProvider] = useState<"trainfabric_gpu" | "runner">("trainfabric_gpu");
  const [runnerId, setRunnerId] = useState("");

  const needsGoalStep = Boolean(
    briefProbe && (!briefProbe.present || briefProbe.isPlaceholder),
  );

  const steps = useMemo(() => {
    const list: { id: StepId; label: string }[] = [
      { id: "connect", label: "Connect" },
      { id: "repo", label: "Repo" },
    ];
    if (needsGoalStep) list.push({ id: "goal", label: "Goal" });
    list.push({ id: "data", label: "Data" }, { id: "launch", label: "Launch" });
    return list;
  }, [needsGoalStep]);

  const stepId = steps[Math.min(stepIdx, steps.length - 1)]?.id ?? "connect";

  useEffect(() => {
    // Keep index in range when Goal step appears/disappears.
    setStepIdx((i) => Math.min(i, Math.max(0, steps.length - 1)));
  }, [steps.length]);

  useEffect(() => {
    apiFetch<{ datasets: DatasetMeta[] }>("/datasets", { token: authToken })
      .then((ds) => setDatasets(ds.datasets ?? []))
      .catch(() => setDatasets([]));
  }, [authToken]);

  async function refreshGithub(): Promise<GithubConnectionStatus | null> {
    if (!authToken) return null;
    setGhLoading(true);
    try {
      const status = await apiFetch<GithubConnectionStatus>("/github/status", { token: authToken });
      setGhStatus(status);
      if (status.connected) {
        const inst = await apiFetch<{ installations: GhInstall[] }>("/github/installations", {
          token: authToken,
        });
        const list = inst.installations ?? [];
        setGhInstalls(list);
        setInstallationId((prev) => prev ?? list[0]?.installationId ?? null);
        if (stepId === "connect") setStepIdx(1);
      } else {
        setGhInstalls([]);
        setInstallationId(null);
      }
      return status;
    } catch {
      const fallback: GithubConnectionStatus = {
        configured: false,
        connected: false,
        installationCount: 0,
      };
      setGhStatus(fallback);
      return fallback;
    } finally {
      setGhLoading(false);
    }
  }

  useEffect(() => {
    void refreshGithub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  useEffect(() => {
    const flag = searchParams.get("github");
    if (!flag || !authToken) return;
    if (flag === "connected") {
      void (async () => {
        const status = await refreshGithub();
        if (status?.connected) {
          toast.success("GitHub connected");
          setStepIdx(1);
        } else {
          toast.error("GitHub install finished but nothing was linked. Try Connect again.");
        }
        router.replace("/agents/new", { scroll: false });
      })();
    } else if (flag === "error") {
      toast.error(searchParams.get("reason") || "GitHub connection failed");
      router.replace("/agents/new", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, authToken]);

  useEffect(() => {
    if (!authToken || !installationId) {
      setGhRepos([]);
      setRepoSelection(undefined);
      setRepoTotalCount(null);
      return;
    }
    apiFetch<{
      repos: GhRepo[];
      totalCount?: number;
      repositorySelection?: "all" | "selected";
    }>(`/github/installations/${installationId}/repos`, {
      token: authToken,
    })
      .then((r) => {
        setGhRepos(r.repos ?? []);
        setRepoTotalCount(r.totalCount ?? r.repos?.length ?? 0);
        setRepoSelection(r.repositorySelection);
      })
      .catch(() => {
        setGhRepos([]);
        setRepoSelection(undefined);
        setRepoTotalCount(null);
      });
  }, [authToken, installationId]);

  useEffect(() => {
    const parsed = parseOwnerRepo(selectedFullName || repoUrl);
    if (!parsed || !authToken) {
      setBriefProbe(null);
      return;
    }
    let cancelled = false;
    setBriefChecking(true);
    const q = new URLSearchParams({
      owner: parsed.owner,
      repo: parsed.repo,
      ref: branch.trim() || "main",
    });
    if (installationId) q.set("installationId", String(installationId));
    apiFetch<BriefProbe>(`/github/research-brief?${q}`, { token: authToken })
      .then((out) => {
        if (cancelled) return;
        setBriefProbe(out);
        if (out.present && !out.isPlaceholder) setGoal("");
      })
      .catch(() => {
        if (cancelled) return;
        // Fail open toward requiring a goal when we can't inspect.
        setBriefProbe({ present: false });
      })
      .finally(() => {
        if (!cancelled) setBriefChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authToken, selectedFullName, repoUrl, branch, installationId]);

  const filteredRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return ghRepos;
    return ghRepos.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [ghRepos, repoSearch]);

  const selectedDatasets = useMemo(
    () =>
      selectedDatasetIds
        .map((id) => datasets.find((d) => d.id === id))
        .filter(Boolean) as DatasetMeta[],
    [datasets, selectedDatasetIds],
  );

  async function connectGithub() {
    if (!authToken) {
      toast.error("Sign in to connect GitHub");
      return;
    }
    setConnectingGh(true);
    try {
      const out = await apiFetch<{ url: string }>("/github/install", {
        method: "POST",
        token: authToken,
        body: JSON.stringify({ returnTo: "/agents/new" }),
      });
      window.location.href = out.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start GitHub connect");
      setConnectingGh(false);
    }
  }

  async function disconnectGithub() {
    if (!authToken) return;
    try {
      await apiFetch("/github/connection", { method: "DELETE", token: authToken });
      setGhStatus({ configured: true, connected: false, installationCount: 0 });
      setGhInstalls([]);
      setInstallationId(null);
      setGhRepos([]);
      toast.success("GitHub disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not disconnect GitHub");
    }
  }

  function selectRepo(repo: GhRepo) {
    setSelectedFullName(repo.fullName);
    setRepoUrl(repo.htmlUrl.replace(/\.git$/, ""));
    setBranch(repo.defaultBranch || "main");
    setGithubRepoId(repo.id);
    setCreatedFromPlatform(false);
  }

  async function createRepo() {
    if (!authToken || !installationId || !newRepoName.trim()) {
      toast.error("Pick an account and enter a repo name");
      return;
    }
    setCreatingRepo(true);
    try {
      const out = await apiFetch<CreateGithubRepoResponse>("/github/repos", {
        method: "POST",
        token: authToken,
        body: JSON.stringify({
          installationId,
          name: newRepoName.trim(),
          private: newRepoPrivate,
          description: newRepoDesc.trim() || undefined,
          defaultBranch: "main",
        }),
      });
      setSelectedFullName(out.fullName);
      setRepoUrl(out.htmlUrl);
      setBranch(out.defaultBranch || "main");
      setGithubRepoId(out.githubRepoId);
      setCreatedFromPlatform(true);
      setRepoMode("pick");
      toast.success(`Created ${out.fullName}`);
      const r = await apiFetch<{
        repos: GhRepo[];
        totalCount?: number;
        repositorySelection?: "all" | "selected";
      }>(`/github/installations/${installationId}/repos`, {
        token: authToken,
      });
      setGhRepos(r.repos ?? []);
      setRepoTotalCount(r.totalCount ?? r.repos?.length ?? 0);
      setRepoSelection(r.repositorySelection);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreatingRepo(false);
    }
  }

  function canAdvance(): boolean {
    if (stepId === "connect") return Boolean(ghStatus?.connected);
    if (stepId === "repo") {
      if (briefChecking) return false;
      if (selectedFullName && installationId) return true;
      return isLikelyGitUrl(repoUrl);
    }
    if (stepId === "goal") return goal.trim().length >= 12;
    if (stepId === "data") return true;
    return true;
  }

  async function enrichGoal() {
    if (!authToken || goal.trim().length < 8) {
      toast.error("Write a short goal first, then enrich");
      return;
    }
    setEnriching(true);
    try {
      const out = await apiFetch<{ goal: string }>("/auto/goal/enrich", {
        method: "POST",
        token: authToken,
        body: JSON.stringify({
          draft: goal.trim(),
          repoFullName: selectedFullName || repoShortName(repoUrl) || undefined,
          metric: metric.trim() || undefined,
        }),
      });
      setGoal(out.goal);
      toast.success("Goal enriched");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enrich failed");
    } finally {
      setEnriching(false);
    }
  }

  async function start() {
    setStarting(true);
    try {
      if (needsGoalStep && goal.trim().length < 12) {
        toast.error("Add a research goal — this repo has no TRAINFABRIC.md / AGENTS.md brief");
        setStarting(false);
        return;
      }
      const display = selectedFullName || repoShortName(repoUrl);
      const run = await apiFetch<AutoRun>(`/auto`, {
        method: "POST",
        token: authToken,
        body: JSON.stringify({
          goal: needsGoalStep ? goal.trim() : goal.trim() || undefined,
          repoUrl:
            repoUrl.trim() ||
            (selectedFullName ? `https://github.com/${selectedFullName}` : undefined),
          repoFullName: selectedFullName || undefined,
          installationId: installationId ?? undefined,
          githubRepoId,
          createdFromPlatform: createdFromPlatform || undefined,
          defaultBranch: branch.trim() || "main",
          datasetIds: selectedDatasetIds.length ? selectedDatasetIds : undefined,
          datasetId: selectedDatasetIds[0],
          protocol: {
            metric: { name: metric.trim() || "score", direction },
            budget: {
              maxTrials: Number(maxTrials) || DEFAULT_PROTOCOL.budget.maxTrials,
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
            runnerId: runnerId.trim() || undefined,
          },
        }),
      });
      trackAutoRun({
        autoRunId: run.id,
        datasetId: run.datasetId,
        name: `Auto · ${display}`,
      });
      toast.success("Agent started");
      router.push(`/auto/${run.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start agent";
      toast.error(msg.includes("Box") || msg.includes("box") ? "Sandbox not ready — try again shortly." : msg);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Same path as MCP start_auto
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Start an agent</h1>
        <p className="text-sm text-muted-foreground">
          Authorize GitHub, point at a repo, add a research goal if the repo has no brief, then launch.
        </p>
      </header>

      <ol className="flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={i > stepIdx && !canAdvance()}
              onClick={() => {
                if (i <= stepIdx || (i === stepIdx + 1 && canAdvance())) setStepIdx(i);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition",
                i === stepIdx
                  ? "border-primary bg-primary/15 text-foreground"
                  : i < stepIdx
                    ? "border-[hsl(var(--border-strong))] bg-[hsl(var(--elevated))] text-foreground"
                    : "border-[hsl(var(--border-subtle))] text-muted-foreground",
              )}
            >
              {i + 1}. {s.label}
            </button>
          </li>
        ))}
      </ol>

      <div className="tf-card min-h-[280px] space-y-5 p-5 sm:p-6">
        {stepId === "connect" ? (
          <section className="space-y-4">
            <h2 className="text-base font-semibold">Can we clone and push?</h2>
            <p className="text-sm text-muted-foreground">
              Connect the Trainfabric GitHub App. This is the same authorize + install step an MCP
              agent needs before private repos work.
            </p>
            {ghLoading ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking connection…
              </p>
            ) : null}
            {ghStatus?.connected ? (
              <div className="tf-inset px-4 py-4">
                <p className="text-sm">
                  Connected as{" "}
                  <span className="font-medium">@{ghStatus.login}</span>
                  {ghStatus.installationCount
                    ? ` · ${ghStatus.installationCount} install${ghStatus.installationCount === 1 ? "" : "s"}`
                    : null}
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-0"
                    onClick={() => void connectGithub()}
                  >
                    Manage install
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-0 text-muted-foreground"
                    onClick={() => void disconnectGithub()}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="tf-inset flex flex-col items-start gap-3 px-4 py-5">
                <Button
                  type="button"
                  onClick={() => void connectGithub()}
                  disabled={connectingGh || !authToken}
                >
                  {connectingGh ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Github className="h-4 w-4" />
                  )}
                  Connect GitHub
                </Button>
                {!authToken ? (
                  <p className="text-xs text-muted-foreground">
                    <Link href="/sign-in" className="text-primary hover:underline">
                      Sign in
                    </Link>{" "}
                    first.
                  </p>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {stepId === "repo" ? (
          <section className="space-y-4">
            <h2 className="text-base font-semibold">Which codebase?</h2>
            <p className="text-sm text-muted-foreground">
              The agent loads TRAINFABRIC.md / AGENTS.md / protocol.yaml after clone.
            </p>

            {ghInstalls.length > 1 ? (
              <div className="space-y-1">
                <Label className="text-xs">Account / org</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={installationId ?? ""}
                  onChange={(e) => setInstallationId(Number(e.target.value) || null)}
                >
                  {ghInstalls.map((i) => (
                    <option key={i.installationId} value={i.installationId}>
                      {i.accountLogin}
                    </option>
                  ))}
                </select>
              </div>
            ) : ghInstalls[0] ? (
              <p className="text-xs text-muted-foreground">
                Installing under <span className="font-medium text-foreground">@{ghInstalls[0].accountLogin}</span>
              </p>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["pick", "Your repos"],
                  ["create", "Create"],
                  ["url", "URL"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRepoMode(id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px]",
                    repoMode === id
                      ? "border-primary bg-primary/15"
                      : "border-[hsl(var(--border-subtle))] text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {repoMode === "pick" ? (
              <div className="space-y-2">
                {ghRepos.length > 8 || (repoTotalCount ?? 0) > 8 ? (
                  <Input
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Filter repos…"
                    className="h-9"
                  />
                ) : null}
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={selectedFullName}
                  onChange={(e) => {
                    const r = ghRepos.find((x) => x.fullName === e.target.value);
                    if (r) selectRepo(r);
                    else {
                      setSelectedFullName("");
                      setGithubRepoId(undefined);
                    }
                  }}
                  disabled={ghRepos.length === 0}
                >
                  <option value="">
                    {ghRepos.length === 0
                      ? "No repos yet — create one or grant access"
                      : `Choose a repository… (${filteredRepos.length}${
                          repoTotalCount != null && repoTotalCount !== filteredRepos.length
                            ? ` of ${repoTotalCount}`
                            : ghRepos.length !== filteredRepos.length
                              ? ` of ${ghRepos.length}`
                              : ""
                        })`}
                  </option>
                  {filteredRepos.map((r) => (
                    <option key={r.id} value={r.fullName}>
                      {r.fullName}
                      {r.private ? " (private)" : ""}
                    </option>
                  ))}
                </select>
                {repoSelection === "selected" ? (
                  <p className="text-[11px] text-muted-foreground">
                    GitHub App access is limited to selected repos ({repoTotalCount ?? ghRepos.length}
                    ).{" "}
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => void connectGithub()}
                    >
                      Configure on GitHub
                    </button>{" "}
                    to add more, or use the URL tab for a public repo.
                  </p>
                ) : ghRepos.length > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Showing {ghRepos.length}
                    {repoTotalCount != null && repoTotalCount !== ghRepos.length
                      ? ` of ${repoTotalCount}`
                      : ""}{" "}
                    repos for this installation.
                  </p>
                ) : null}
                {selectedFullName && branch !== "main" ? (
                  <div className="space-y-1">
                    <Label className="text-xs">Branch</Label>
                    <Input value={branch} onChange={(e) => setBranch(e.target.value)} className="h-9" />
                  </div>
                ) : null}
              </div>
            ) : null}

            {repoMode === "create" ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={newRepoName}
                    onChange={(e) => setNewRepoName(e.target.value)}
                    placeholder="my-autoresearch"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Input
                    value={newRepoDesc}
                    onChange={(e) => setNewRepoDesc(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={newRepoPrivate}
                    onChange={(e) => setNewRepoPrivate(e.target.checked)}
                  />
                  Private (recommended)
                </label>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void createRepo()}
                  disabled={creatingRepo || !newRepoName.trim()}
                >
                  {creatingRepo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Create & select
                </Button>
              </div>
            ) : null}

            {repoMode === "url" ? (
              <div className="space-y-2">
                <Label className="text-xs">Public repo URL</Label>
                <Input
                  value={repoUrl}
                  onChange={(e) => {
                    setRepoUrl(e.target.value);
                    setSelectedFullName("");
                    setGithubRepoId(undefined);
                    setCreatedFromPlatform(false);
                  }}
                  placeholder="https://github.com/org/repo"
                />
                <div className="space-y-1">
                  <Label className="text-xs">Branch</Label>
                  <Input value={branch} onChange={(e) => setBranch(e.target.value)} className="h-9" />
                </div>
              </div>
            ) : null}

            {briefChecking ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking for TRAINFABRIC.md / AGENTS.md…
              </p>
            ) : briefProbe?.present && !briefProbe.isPlaceholder ? (
              <p className="text-xs text-muted-foreground">
                Found research brief
                {briefProbe.sourceFile ? (
                  <>
                    {" "}
                    in <code className="text-[10px]">{briefProbe.sourceFile}</code>
                  </>
                ) : null}
                .
              </p>
            ) : (selectedFullName || isLikelyGitUrl(repoUrl)) && briefProbe ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                No research brief in this repo
                {briefProbe.isPlaceholder ? " (starter stub only)" : ""}. Next step: write a goal.
              </p>
            ) : null}
          </section>
        ) : null}

        {stepId === "goal" ? (
          <section className="space-y-4">
            <h2 className="text-base font-semibold">Research goal</h2>
            <p className="text-sm text-muted-foreground">
              This repo has no TRAINFABRIC.md / AGENTS.md brief
              {briefProbe?.isPlaceholder ? " (only the starter stub)" : ""}. Write the campaign goal
              — required to start. Optionally enrich it with AI into a full brief.
            </p>
            <div className="space-y-2">
              <Label className="text-xs">Goal</Label>
              <Textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={8}
                placeholder="e.g. Lower validation MAE on NYC taxi fares; keep prepare.py and protocol.yaml immutable…"
                className="min-h-[160px] text-sm"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Passed to the agent as AUTORUN_GOAL (overrides missing repo brief).
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={enriching || goal.trim().length < 8 || !authToken}
                  onClick={() => void enrichGoal()}
                >
                  {enriching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Enrich with AI
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {stepId === "data" ? (
          <section className="space-y-4">
            <h2 className="text-base font-semibold">Constrain data? (optional)</h2>
            <p className="text-sm text-muted-foreground">
              Leave empty and the agent picks from the repo brief — same as omitting{" "}
              <code className="text-[11px]">dataset_ids</code> in MCP.
            </p>
            <DatasetMultiSelect
              datasets={datasets}
              value={selectedDatasetIds}
              onChange={setSelectedDatasetIds}
            />
          </section>
        ) : null}

        {stepId === "launch" ? (
          <section className="space-y-4">
            <h2 className="text-base font-semibold">Ready to launch</h2>
            <dl className="tf-inset space-y-3 px-4 py-4 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Repo</dt>
                <dd className="mt-0.5 font-medium">
                  {selectedFullName || repoShortName(repoUrl) || "—"} @ {branch || "main"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Goal</dt>
                <dd className="mt-0.5 text-muted-foreground">
                  {needsGoalStep
                    ? goal.trim()
                      ? goal.trim().length > 140
                        ? `${goal.trim().slice(0, 140)}…`
                        : goal.trim()
                      : "Required — write on the Goal step"
                    : briefProbe?.sourceFile
                      ? `From ${briefProbe.sourceFile}`
                      : "From repo brief"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Datasets</dt>
                <dd className="mt-0.5">
                  {selectedDatasets.length
                    ? selectedDatasets.map((d) => `${d.owner}/${d.name}`).join(", ")
                    : "Agent chooses from repo brief"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Compute</dt>
                <dd className="mt-0.5">{provider === "trainfabric_gpu" ? "Trainfabric GPU (default)" : `Runner · ${runnerId}`}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Protocol</dt>
                <dd className="mt-0.5 text-muted-foreground">
                  {metric} · {direction} · {maxTrials} trials — override in Advanced if needed
                </dd>
              </div>
            </dl>

            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide advanced" : "Advanced protocol & compute"}
            </button>

            {showAdvanced ? (
              <div className="tf-inset space-y-3 p-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Metric</Label>
                    <Input value={metric} onChange={(e) => setMetric(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Direction</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={direction}
                      onChange={(e) => setDirection(e.target.value as "min" | "max")}
                    >
                      <option value="min">min</option>
                      <option value="max">max</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
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
                  <Label className="text-xs">Mutable paths</Label>
                  <Input value={mutablePaths} onChange={(e) => setMutablePaths(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Immutable paths</Label>
                  <Textarea
                    value={immutablePaths}
                    onChange={(e) => setImmutablePaths(e.target.value)}
                    rows={2}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Compute</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as "trainfabric_gpu" | "runner")}
                  >
                    <option value="trainfabric_gpu">Trainfabric GPU</option>
                    <option value="runner">Self-hosted runner</option>
                  </select>
                </div>
                {provider === "runner" ? (
                  <div className="space-y-1">
                    <Label className="text-xs">Runner id</Label>
                    <Input value={runnerId} onChange={(e) => setRunnerId(e.target.value)} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <footer className="tf-surface sticky bottom-4 flex items-center justify-between gap-3 rounded-xl px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          disabled={stepIdx === 0}
          onClick={() => setStepIdx((s) => Math.max(0, s - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        {stepIdx < steps.length - 1 ? (
          <Button
            type="button"
            disabled={!canAdvance()}
            onClick={() => setStepIdx((s) => Math.min(steps.length - 1, s + 1))}
          >
            Continue
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            disabled={
              starting ||
              !canAdvance() ||
              (!selectedFullName && !isLikelyGitUrl(repoUrl)) ||
              (needsGoalStep && goal.trim().length < 12)
            }
            onClick={() => void start()}
            className="bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] hover:bg-[hsl(var(--success))]/90"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Start agent
          </Button>
        )}
      </footer>
    </div>
  );
}
