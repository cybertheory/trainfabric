"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Github,
  GitBranch,
  Loader2,
  Plus,
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
import { apiFetch, publicApiOrigin } from "@/lib/api";
import { useJobTracker } from "@/lib/job-tracker";
import { cn } from "@/lib/utils";
import { DatasetMultiSelect } from "@/components/dataset-multi-select";

const STEPS = ["Repo", "Protocol", "Compute", "Review"] as const;

type Prereq = {
  boxConfigured: boolean;
  modalConfigured: boolean;
  note: string;
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
  return url.trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "") || url;
}

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
  const { trackAutoRun, authToken } = useJobTracker();
  const [step, setStep] = useState(0);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [prereq, setPrereq] = useState<Prereq | null>(null);
  const [starting, setStarting] = useState(false);

  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [repoTab, setRepoTab] = useState<"repos" | "create" | "advanced">("repos");
  const [ghStatus, setGhStatus] = useState<GithubConnectionStatus | null>(null);
  const [ghInstalls, setGhInstalls] = useState<GhInstall[]>([]);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [ghRepos, setGhRepos] = useState<GhRepo[]>([]);
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
  const [metric, setMetric] = useState("val_bpb");
  const [direction, setDirection] = useState<"min" | "max">("min");
  const [maxTrials, setMaxTrials] = useState(20);
  const [wallSec, setWallSec] = useState(3600);
  const [mutablePaths, setMutablePaths] = useState("train.py");
  const [immutablePaths, setImmutablePaths] = useState("prepare.py,protocol.yaml");
  const [provider, setProvider] = useState<"modal" | "runner">("modal");
  const [modalRef, setModalRef] = useState("");
  const [runnerId, setRunnerId] = useState("");
  const [runners, setRunners] = useState<
    Array<{ id: string; name: string; capacity?: string; lastHeartbeatAt?: number }>
  >([]);
  const [registering, setRegistering] = useState(false);
  const [newRunnerName, setNewRunnerName] = useState("home-gpu");
  const [freshRunner, setFreshRunner] = useState<{
    runnerId: string;
    token: string;
    docker: string;
  } | null>(null);

  const GPU_RUNNER_REPO = "https://github.com/cybertheory/trainfabric-gpu-runner";

  useEffect(() => {
    Promise.all([
      apiFetch<{ datasets: DatasetMeta[] }>("/datasets", { token: authToken }).catch(() => ({
        datasets: [],
      })),
      apiFetch<{ prerequisites?: Prereq }>("/auto", { token: authToken }).catch(() => ({
        prerequisites: undefined,
      })),
    ]).then(([ds, auto]) => {
      setDatasets(ds.datasets ?? []);
      if (auto.prerequisites) setPrereq(auto.prerequisites);
    });
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;
    apiFetch<{ runners: Array<{ id: string; name: string; capacity?: string; lastHeartbeatAt?: number }> }>(
      "/runners",
      { token: authToken },
    )
      .then((r) => setRunners(r.runners ?? []))
      .catch(() => setRunners([]));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per token
  }, [authToken]);

  useEffect(() => {
    const flag = searchParams.get("github");
    if (!flag || !authToken) return;
    if (flag === "connected") {
      void (async () => {
        const status = await refreshGithub();
        if (status?.connected) {
          toast.success("GitHub connected");
        } else {
          toast.error("GitHub install finished but no account was linked. Try Connect GitHub again.");
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
      return;
    }
    apiFetch<{ repos: GhRepo[] }>(`/github/installations/${installationId}/repos`, {
      token: authToken,
    })
      .then((r) => setGhRepos(r.repos ?? []))
      .catch(() => setGhRepos([]));
  }, [authToken, installationId]);

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
        body: JSON.stringify({ returnTo: "/agents/new?github=connected" }),
      });
      window.location.href = out.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start GitHub install");
      setConnectingGh(false);
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
      toast.error("Pick an installation and enter a repo name");
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
      setRepoTab("repos");
      toast.success(`Created ${out.fullName}`);
      // Refresh list
      const r = await apiFetch<{ repos: GhRepo[] }>(
        `/github/installations/${installationId}/repos`,
        { token: authToken },
      );
      setGhRepos(r.repos ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create repo failed");
    } finally {
      setCreatingRepo(false);
    }
  }

  const filteredRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return ghRepos;
    return ghRepos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q),
    );
  }, [ghRepos, repoSearch]);

  async function registerRunner() {
    if (!authToken) {
      toast.error("Sign in to register a GPU runner");
      return;
    }
    setRegistering(true);
    try {
      const out = await apiFetch<{ runnerId: string; token: string }>("/runners/register", {
        method: "POST",
        token: authToken,
        body: JSON.stringify({ name: newRunnerName.trim() || "gpu-runner", capacity: "gpu:1" }),
      });
      setRunnerId(out.runnerId);
      setRunners((prev) => [{ id: out.runnerId, name: newRunnerName.trim() || "gpu-runner" }, ...prev]);
      const docker = [
        `git clone ${GPU_RUNNER_REPO}.git && cd trainfabric-gpu-runner`,
        "docker build -t trainfabric/gpu-runner .",
        `docker run --rm -e TF_API_URL=https://trainfabric-router.rishabhspro.workers.dev -e RUNNER_TOKEN=${out.token} trainfabric/gpu-runner`,
      ].join("\n");
      setFreshRunner({ runnerId: out.runnerId, token: out.token, docker });
      toast.success("Runner registered — copy the token (shown once)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Register failed");
    } finally {
      setRegistering(false);
    }
  }

  const selectedDatasets = useMemo(
    () =>
      selectedDatasetIds
        .map((id) => datasets.find((d) => d.id === id))
        .filter(Boolean) as DatasetMeta[],
    [datasets, selectedDatasetIds],
  );

  function canNext(): boolean {
    if (step === 0) {
      if (selectedFullName && installationId) return true;
      return isLikelyGitUrl(repoUrl);
    }
    if (step === 1) {
      return (
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
      const display = selectedFullName || repoShortName(repoUrl);
      const run = await apiFetch<AutoRun>(`/auto`, {
        method: "POST",
        token: authToken,
        body: JSON.stringify({
          repoUrl: repoUrl.trim() || (selectedFullName ? `https://github.com/${selectedFullName}` : undefined),
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
        name: `Auto · ${display}`,
      });
      toast.success("Agent started", {
        description: selectedDatasetIds.length
          ? "Cloning the repo, then running with your selected dataset(s)."
          : "Cloning the repo for goals and instructions, then choosing a dataset.",
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
          Connect a <span className="font-medium text-foreground">GitHub repo</span> first — research
          goals and instructions live in that repo (README, AGENTS.md, protocol.yaml). Then set the
          experiment protocol and compute. The agent discovers datasets from the repo brief.
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
            Worker secrets. You connect the repo and protocol below.
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
            <h2 className="text-sm font-semibold">1. Connect GitHub repo</h2>
            <p className="text-xs text-muted-foreground">
              Install the Trainfabric GitHub App, then pick or create a repo. The agent loads{" "}
              <code className="text-[11px]">TRAINFABRIC.md</code> /{" "}
              <code className="text-[11px]">AGENTS.md</code> /{" "}
              <code className="text-[11px]">protocol.yaml</code> after clone.
            </p>

            {ghLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking GitHub connection…
              </div>
            ) : null}

            {ghStatus && !ghStatus.configured ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                GitHub App is not configured on the API (
                <code className="text-[11px]">GITHUB_APP_*</code> secrets). You can still paste a
                public repo URL under Advanced. Callback base:{" "}
                <code className="text-[11px]">{publicApiOrigin()}</code>
              </div>
            ) : null}

            {ghStatus?.configured && !ghStatus.connected ? (
              <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-3">
                <p className="text-xs text-muted-foreground">
                  Connect GitHub to browse private repos, create seeded autoresearch repos, and
                  authorize clone/push for the agent.
                </p>
                <Button type="button" size="sm" onClick={() => void connectGithub()} disabled={connectingGh}>
                  {connectingGh ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Github className="h-3.5 w-3.5" />
                  )}
                  Connect GitHub
                </Button>
              </div>
            ) : null}

            {ghStatus?.connected ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <p className="text-muted-foreground">
                    Connected as{" "}
                    <span className="font-medium text-foreground">@{ghStatus.login}</span>
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void connectGithub()}
                  >
                    Manage install
                  </Button>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Account / org</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={installationId ?? ""}
                    onChange={(e) => setInstallationId(Number(e.target.value) || null)}
                  >
                    {ghInstalls.map((i) => (
                      <option key={i.installationId} value={i.installationId}>
                        {i.accountLogin} ({i.accountType})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["repos", "Your repos"],
                      ["create", "Create repo"],
                      ["advanced", "Advanced URL"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setRepoTab(id)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px]",
                        repoTab === id
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {repoTab === "repos" ? (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Select repo</Label>
                      {ghRepos.length > 8 ? (
                        <Input
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                          placeholder="Filter repos…"
                          className="h-8 text-sm"
                        />
                      ) : null}
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={selectedFullName}
                        onChange={(e) => {
                          const full = e.target.value;
                          const r = ghRepos.find((x) => x.fullName === full);
                          if (r) selectRepo(r);
                          else {
                            setSelectedFullName("");
                            setGithubRepoId(undefined);
                            setRepoUrl("");
                            setCreatedFromPlatform(false);
                          }
                        }}
                        disabled={ghRepos.length === 0}
                      >
                        <option value="">
                          {ghRepos.length === 0
                            ? "No repos in this installation"
                            : "Choose a repository…"}
                        </option>
                        {filteredRepos.map((r) => (
                          <option key={r.id} value={r.fullName}>
                            {r.fullName}
                            {r.private ? " (private)" : ""} · {r.defaultBranch}
                          </option>
                        ))}
                      </select>
                    </div>
                    {ghRepos.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        No repos in this installation. Create one or grant the App access under Manage
                        install.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {repoTab === "create" ? (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Repository name</Label>
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
                        placeholder="Trainfabric autoresearch campaign"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={newRepoPrivate}
                        onChange={(e) => setNewRepoPrivate(e.target.checked)}
                      />
                      Private repository (recommended)
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      Seeds <code>TRAINFABRIC.md</code>, <code>protocol.yaml</code>,{" "}
                      <code>AGENTS.md</code>, and <code>.gitignore</code>.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void createRepo()}
                      disabled={creatingRepo || !newRepoName.trim()}
                    >
                      {creatingRepo ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Create repo
                    </Button>
                  </div>
                ) : null}

                {repoTab === "advanced" ? (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Public repo URL</Label>
                      <Input
                        value={repoUrl}
                        onChange={(e) => {
                          setRepoUrl(e.target.value);
                          setSelectedFullName("");
                          setGithubRepoId(undefined);
                          setCreatedFromPlatform(false);
                        }}
                        placeholder="https://github.com/org/public-repo"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {(!ghStatus?.connected || repoTab === "advanced") && ghStatus && !ghStatus.connected ? (
              <div className="space-y-1">
                <Label className="text-xs">Public repo URL (fallback)</Label>
                <Input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/org/autoresearch-repo"
                />
              </div>
            ) : null}

            <div className="space-y-1">
              <Label className="text-xs">Default branch</Label>
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
            </div>
            <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <GitBranch className="h-3.5 w-3.5" />
                What the agent loads from the repo
              </p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                <li>
                  Goal / brief: <code>TRAINFABRIC.md</code> → <code>AGENTS.md</code> →{" "}
                  <code>README.md</code>
                </li>
                <li>
                  Eval contract: <code>protocol.yaml</code> (immutable by default)
                </li>
                <li>Mutable code paths you list in the next step</li>
              </ul>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Datasets (optional)</Label>
              <DatasetMultiSelect
                datasets={datasets}
                value={selectedDatasetIds}
                onChange={setSelectedDatasetIds}
              />
              <p className="text-[11px] text-muted-foreground">
                Optional. Leave empty and the agent chooses data from the repo brief or agent
                description. Select one or more to constrain which lakehouse datasets it may use.
              </p>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">2. Experiment protocol</h2>
            <p className="text-xs text-muted-foreground">
              Soft defaults for the control plane. Prefer encoding the real contract in the repo&apos;s{" "}
              <code className="text-[11px]">protocol.yaml</code> — these fields are the comparable
              budget the platform enforces.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Metric name</Label>
                <Input value={metric} onChange={(e) => setMetric(e.target.value)} />
              </div>
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
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Connect any GPU machine over HTTPS — no SSH. Public runner:{" "}
                  <a
                    href={GPU_RUNNER_REPO}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    cybertheory/trainfabric-gpu-runner
                  </a>
                  . Docs:{" "}
                  <Link href="/docs/agents" className="text-primary hover:underline">
                    /docs/agents
                  </Link>
                  .
                </p>
                {runners.length > 0 ? (
                  <div className="space-y-1">
                    <Label className="text-xs">Your runners</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={runnerId}
                      onChange={(e) => setRunnerId(e.target.value)}
                    >
                      <option value="">Select a registered runner…</option>
                      {runners.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} · {r.id}
                          {r.lastHeartbeatAt
                            ? ` · seen ${new Date(r.lastHeartbeatAt).toLocaleString()}`
                            : " · never seen"}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="space-y-1">
                  <Label className="text-xs">Runner id</Label>
                  <Input
                    value={runnerId}
                    onChange={(e) => setRunnerId(e.target.value)}
                    placeholder="runner_…"
                  />
                </div>
                <div className="rounded-md border border-dashed bg-muted/20 p-3 space-y-2">
                  <p className="text-xs font-medium">Register a new runner</p>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="h-9 max-w-[12rem]"
                      value={newRunnerName}
                      onChange={(e) => setNewRunnerName(e.target.value)}
                      placeholder="home-gpu"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={registering || !authToken}
                      onClick={() => void registerRunner()}
                    >
                      {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Register runner
                    </Button>
                  </div>
                  {freshRunner ? (
                    <div className="space-y-1.5 text-[11px]">
                      <p>
                        <span className="text-muted-foreground">runnerId</span>{" "}
                        <code className="break-all">{freshRunner.runnerId}</code>
                      </p>
                      <p>
                        <span className="text-muted-foreground">token (once)</span>{" "}
                        <code className="break-all">{freshRunner.token}</code>
                      </p>
                      <pre className="overflow-x-auto rounded bg-background p-2 text-[10px] leading-relaxed">
                        {freshRunner.docker}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      After register, run the docker command on your GPU box, then continue with the
                      runner id selected above.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">4. Review & start</h2>
            <dl className="space-y-2 rounded-md bg-muted/30 p-3 text-xs">
              <Row
                k="Repo"
                v={`${selectedFullName || repoShortName(repoUrl)} @ ${branch || "main"}`}
              />
              <Row
                k="Instructions"
                v="Loaded from TRAINFABRIC.md / AGENTS.md / README.md after clone"
              />
              <Row
                k="Datasets"
                v={
                  selectedDatasets.length
                    ? selectedDatasets.map((d) => `${d.owner}/${d.name}`).join(", ")
                    : "Agent chooses from repo / description"
                }
              />
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
              Starting creates an AutoRun, provisions Box when configured, clones the repo for goals
              and instructions, then opens the live monitor + chat.
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
