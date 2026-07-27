"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Github, Link2, Plug, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJobTracker } from "@/lib/job-tracker";
import { apiFetch, publicApiOrigin } from "@/lib/api";
import { cn } from "@/lib/utils";

export type TokenGetter = () => Promise<string | null>;

type SourceMode = "upload" | "link" | "connect";
type ConnectTab = "github" | "huggingface";

type GhStatus = {
  configured: boolean;
  connected: boolean;
  login?: string;
  installationCount: number;
};

type HfStatus = {
  configured: boolean;
  connected: boolean;
  login?: string;
};

type GhInstall = {
  installationId: number;
  accountLogin: string;
  accountType: string;
};

type GhRepo = {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
};

type GhTreeEntry = {
  path: string;
  type: "file" | "dir";
  size?: number;
  ingestible?: boolean;
};

type HfDataset = {
  id: string;
  private?: boolean;
  gated?: boolean | string;
};

function isSupportedRemoteHost(url: string): boolean {
  try {
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = new URL(href).hostname.toLowerCase();
    return (
      host === "huggingface.co" ||
      host === "www.huggingface.co" ||
      host === "hf.co" ||
      host === "github.com" ||
      host === "www.github.com" ||
      host === "raw.githubusercontent.com"
    );
  } catch {
    return false;
  }
}

export function PublishForm({ getToken }: { getToken: TokenGetter }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { trackJob } = useJobTracker();
  const [sourceMode, setSourceMode] = useState<SourceMode>("upload");
  const [connectTab, setConnectTab] = useState<ConnectTab>("github");
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [showExamples, setShowExamples] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [partitionHint, setPartitionHint] = useState("");
  const [sortColumn, setSortColumn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [ghStatus, setGhStatus] = useState<GhStatus | null>(null);
  const [hfStatus, setHfStatus] = useState<HfStatus | null>(null);
  const [ghInstalls, setGhInstalls] = useState<GhInstall[]>([]);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [ghRepos, setGhRepos] = useState<GhRepo[]>([]);
  const [repoFullName, setRepoFullName] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [treePath, setTreePath] = useState("");
  const [treeEntries, setTreeEntries] = useState<GhTreeEntry[]>([]);
  const [selectedGhPath, setSelectedGhPath] = useState("");
  const [hfDatasets, setHfDatasets] = useState<HfDataset[]>([]);
  const [hfSearch, setHfSearch] = useState("");
  const [selectedHfId, setSelectedHfId] = useState("");
  const [hfPath, setHfPath] = useState("");
  const [hfRevision, setHfRevision] = useState("main");
  const [connectBusy, setConnectBusy] = useState(false);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) {
        setFile(f);
        if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
      }
    },
    [name],
  );

  async function withToken(): Promise<string | null> {
    return getToken();
  }

  async function refreshConnections() {
    const token = await withToken();
    if (!token) return;
    try {
      const [gh, hf] = await Promise.all([
        apiFetch<GhStatus>("/github/status", { token }).catch(() => null),
        apiFetch<HfStatus>("/huggingface/status", { token }).catch(() => null),
      ]);
      if (gh) setGhStatus(gh);
      if (hf) setHfStatus(hf);
      if (gh?.connected) {
        const inst = await apiFetch<{ installations: GhInstall[] }>("/github/installations", {
          token,
        });
        const list = inst.installations ?? [];
        setGhInstalls(list);
        setInstallationId((prev) => prev ?? list[0]?.installationId ?? null);
      } else {
        setGhInstalls([]);
        setInstallationId(null);
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void refreshConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ghFlag = searchParams.get("github");
    const hfFlag = searchParams.get("huggingface");
    if (!ghFlag && !hfFlag) return;
    void (async () => {
      if (ghFlag === "connected") {
        setSourceMode("connect");
        setConnectTab("github");
        await refreshConnections();
        toast.success("GitHub connected");
      } else if (ghFlag === "error") {
        toast.error(searchParams.get("reason") || "GitHub connection failed");
      }
      if (hfFlag === "connected") {
        setSourceMode("connect");
        setConnectTab("huggingface");
        await refreshConnections();
        toast.success("Hugging Face connected");
      } else if (hfFlag === "error") {
        toast.error(searchParams.get("reason") || "Hugging Face connection failed");
      }
      router.replace("/new", { scroll: false });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!installationId) {
      setGhRepos([]);
      return;
    }
    void (async () => {
      const token = await withToken();
      if (!token) return;
      try {
        const out = await apiFetch<{ repos: GhRepo[] }>(
          `/github/installations/${installationId}/repos`,
          { token },
        );
        setGhRepos(out.repos ?? []);
      } catch {
        setGhRepos([]);
      }
    })();
  }, [installationId]);

  useEffect(() => {
    if (!installationId || !repoFullName) {
      setTreeEntries([]);
      return;
    }
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) return;
    void (async () => {
      const token = await withToken();
      if (!token) return;
      try {
        const q = new URLSearchParams({
          owner,
          repo,
          path: treePath,
          recursive: treePath ? "0" : "1",
        });
        const out = await apiFetch<{ entries: GhTreeEntry[] }>(
          `/github/installations/${installationId}/tree?${q}`,
          { token },
        );
        setTreeEntries(out.entries ?? []);
      } catch {
        setTreeEntries([]);
      }
    })();
  }, [installationId, repoFullName, treePath]);

  useEffect(() => {
    if (connectTab !== "huggingface" || !hfStatus?.connected) return;
    void (async () => {
      const token = await withToken();
      if (!token) return;
      try {
        const q = new URLSearchParams();
        if (hfSearch.trim()) q.set("search", hfSearch.trim());
        const out = await apiFetch<{ datasets: HfDataset[] }>(
          `/huggingface/datasets?${q}`,
          { token },
        );
        setHfDatasets(out.datasets ?? []);
      } catch {
        setHfDatasets([]);
      }
    })();
  }, [connectTab, hfStatus?.connected, hfSearch]);

  const filteredRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return ghRepos;
    return ghRepos.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [ghRepos, repoSearch]);

  const selectedRepo = ghRepos.find((r) => r.fullName === repoFullName);

  async function connectGithub() {
    setConnectBusy(true);
    try {
      const token = await withToken();
      if (!token) throw new Error("Sign in required");
      const out = await apiFetch<{ url: string }>("/github/install", {
        token,
        method: "POST",
        body: JSON.stringify({ returnTo: "/new" }),
      });
      window.location.href = out.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start GitHub connect");
      setConnectBusy(false);
    }
  }

  async function connectHf() {
    setConnectBusy(true);
    try {
      const token = await withToken();
      if (!token) throw new Error("Sign in required");
      const out = await apiFetch<{ url: string }>("/huggingface/connect", {
        token,
        method: "POST",
        body: JSON.stringify({ returnTo: "/new" }),
      });
      window.location.href = out.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start Hugging Face connect");
      setConnectBusy(false);
    }
  }

  async function disconnectGithub() {
    try {
      const token = await withToken();
      if (!token) return;
      await apiFetch("/github/connection", { token, method: "DELETE" });
      setGhStatus({ configured: true, connected: false, installationCount: 0 });
      setGhInstalls([]);
      setInstallationId(null);
      toast.message("GitHub disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    }
  }

  async function disconnectHf() {
    try {
      const token = await withToken();
      if (!token) return;
      await apiFetch("/huggingface/connection", { token, method: "DELETE" });
      setHfStatus({ configured: true, connected: false });
      setHfDatasets([]);
      toast.message("Hugging Face disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    }
  }

  function buildConnectedSource(): {
    source_url: string;
    source_auth: "github" | "huggingface";
    installationId?: number;
  } | null {
    if (connectTab === "github") {
      if (!installationId || !repoFullName || !selectedGhPath) return null;
      const [owner, repo] = repoFullName.split("/");
      const ref = selectedRepo?.defaultBranch || "main";
      const path = selectedGhPath.replace(/^\//, "");
      const isFile = /\.(parquet|parq|csv|json|jsonl|ndjson)$/i.test(path);
      const source_url = isFile
        ? `https://github.com/${owner}/${repo}/blob/${ref}/${path}`
        : `https://github.com/${owner}/${repo}/tree/${ref}/${path}`;
      return { source_url, source_auth: "github", installationId };
    }
    if (!selectedHfId) return null;
    const rev = hfRevision.trim() || "main";
    const path = hfPath.trim().replace(/^\//, "");
    const source_url = path
      ? `https://huggingface.co/datasets/${selectedHfId}/tree/${rev}/${path}`
      : `https://huggingface.co/datasets/${selectedHfId}/tree/${rev}`;
    return { source_url, source_auth: "huggingface" };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (sourceMode === "upload" && !file) {
      toast.error("Choose a file");
      return;
    }
    if (sourceMode === "link") {
      const url = sourceUrl.trim();
      if (!url) {
        toast.error("Paste a Hugging Face or GitHub URL");
        return;
      }
      if (!isSupportedRemoteHost(url)) {
        toast.error("Use a huggingface.co or github.com link");
        return;
      }
    }
    let connected: ReturnType<typeof buildConnectedSource> = null;
    if (sourceMode === "connect") {
      connected = buildConnectedSource();
      if (!connected) {
        toast.error(
          connectTab === "github"
            ? "Pick a repo and a file or folder"
            : "Pick a Hugging Face dataset",
        );
        return;
      }
    }

    setSubmitting(true);
    setStatusHint(
      sourceMode === "upload" ? "Uploading…" : "Finding files…",
    );

    try {
      const token = await getToken();
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);

      let json: { datasetId: string; jobId: string; source?: string };

      if (sourceMode === "link" || sourceMode === "connect") {
        headers.set("Content-Type", "application/json");
        const body =
          sourceMode === "connect" && connected
            ? {
                source_url: connected.source_url,
                source_auth: connected.source_auth,
                installationId: connected.installationId,
                name: name || undefined,
                description: description || undefined,
                tags: tags || undefined,
                visibility,
                partition_hint: partitionHint || undefined,
                sort_column: sortColumn || undefined,
              }
            : {
                source_url: sourceUrl.trim(),
                source_auth: "none" as const,
                name: name || undefined,
                description: description || undefined,
                tags: tags || undefined,
                visibility,
                partition_hint: partitionHint || undefined,
                sort_column: sortColumn || undefined,
              };
        const res = await fetch(`${publicApiOrigin()}/datasets`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          let msg = await res.text();
          try {
            const j = JSON.parse(msg) as { error?: string };
            if (j.error) msg = j.error;
          } catch {
            /* keep text */
          }
          throw new Error(msg);
        }
        json = (await res.json()) as typeof json;
      } else {
        const form = new FormData();
        form.append("file", file!);
        form.append("name", name);
        form.append("description", description);
        form.append("tags", tags);
        form.append("visibility", visibility);
        if (partitionHint) form.append("partition_hint", partitionHint);
        if (sortColumn) form.append("sort_column", sortColumn);

        const res = await fetch(`${publicApiOrigin()}/datasets`, {
          method: "POST",
          body: form,
          headers,
        });
        if (!res.ok) throw new Error(await res.text());
        json = (await res.json()) as typeof json;
      }

      const label =
        name ||
        file?.name ||
        connected?.source_url.split("/").filter(Boolean).pop() ||
        sourceUrl.trim().split("/").filter(Boolean).pop() ||
        "dataset";
      trackJob({
        jobId: json.jobId,
        datasetId: json.datasetId,
        name: label,
      });
      const detail =
        json.source === "Hugging Face"
          ? "from Hugging Face"
          : json.source === "GitHub"
            ? "from GitHub"
            : null;
      toast.message(
        detail
          ? `Ingest started ${detail} — tracking in the activity drawer`
          : "Ingest started — tracking in the activity drawer",
      );
      router.push("/home");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
      setStatusHint(null);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Publish dataset</h1>
        <p className="text-muted-foreground">
          Upload a file, paste a public link, or connect GitHub / Hugging Face to pull private or
          gated tabular files.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>File & metadata</CardTitle>
          <CardDescription>Public datasets appear on the index; private are owner-only.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="flex rounded-lg border border-border/80 p-1">
              {(
                [
                  { id: "upload" as const, label: "Upload", Icon: Upload },
                  { id: "link" as const, label: "From link", Icon: Link2 },
                  { id: "connect" as const, label: "Connect & pull", Icon: Plug },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md px-2 py-2 text-sm transition-colors",
                    sourceMode === id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setSourceMode(id)}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            {sourceMode === "upload" ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center ${
                  dragging ? "border-primary bg-accent/40" : ""
                }`}
                onClick={() => document.getElementById("file-input")?.click()}
              >
                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm">{file ? file.name : "Drop CSV / JSON / Parquet here"}</p>
                <input
                  id="file-input"
                  type="file"
                  accept=".csv,.json,.jsonl,.parquet,.parq"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setFile(f);
                      if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
                    }
                  }}
                />
              </div>
            ) : null}

            {sourceMode === "link" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="source-url">
                  Source URL
                </label>
                <Input
                  id="source-url"
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => {
                    setSourceUrl(e.target.value);
                    if (!name) {
                      const parts = e.target.value.split("/").filter(Boolean);
                      const last = parts[parts.length - 1];
                      if (last && !last.includes(".")) setName(last);
                    }
                  }}
                  placeholder="https://huggingface.co/datasets/... or https://github.com/.../tree/main/data"
                />
                <p className="text-xs text-muted-foreground">
                  Public Hugging Face or GitHub links only. For private/gated sources use Connect
                  & pull.
                </p>
                <button
                  type="button"
                  className="text-xs text-primary underline-offset-2 hover:underline"
                  onClick={() => setShowExamples((v) => !v)}
                >
                  {showExamples ? "Hide examples" : "Examples"}
                </button>
                {showExamples ? (
                  <ul className="space-y-1 rounded-md border border-border/70 bg-muted/20 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    <li>
                      Folder:{" "}
                      <span className="text-foreground">
                        https://github.com/owner/repo/tree/main/data
                      </span>
                    </li>
                    <li>
                      File:{" "}
                      <span className="text-foreground">
                        https://huggingface.co/datasets/owner/name/blob/main/train.parquet
                      </span>
                    </li>
                  </ul>
                ) : null}
              </div>
            ) : null}

            {sourceMode === "connect" ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm",
                      connectTab === "github"
                        ? "border-primary bg-accent/40"
                        : "border-border text-muted-foreground",
                    )}
                    onClick={() => setConnectTab("github")}
                  >
                    <Github className="h-4 w-4" />
                    GitHub
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm",
                      connectTab === "huggingface"
                        ? "border-primary bg-accent/40"
                        : "border-border text-muted-foreground",
                    )}
                    onClick={() => setConnectTab("huggingface")}
                  >
                    Hugging Face
                  </button>
                </div>

                {connectTab === "github" ? (
                  <div className="space-y-3 rounded-md border border-border/70 p-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        {ghStatus?.connected
                          ? `Connected${ghStatus.login ? ` as ${ghStatus.login}` : ""}`
                          : ghStatus?.configured === false
                            ? "GitHub App not configured"
                            : "Not connected"}
                      </span>
                      {ghStatus?.connected ? (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                          onClick={() => void disconnectGithub()}
                        >
                          Disconnect
                        </button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={connectBusy || ghStatus?.configured === false}
                          onClick={() => void connectGithub()}
                        >
                          Connect GitHub
                        </Button>
                      )}
                    </div>
                    {ghStatus?.connected ? (
                      <>
                        <Select
                          value={installationId != null ? String(installationId) : ""}
                          onValueChange={(v) => {
                            setInstallationId(Number(v));
                            setRepoFullName("");
                            setSelectedGhPath("");
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Installation" />
                          </SelectTrigger>
                          <SelectContent>
                            {ghInstalls.map((i) => (
                              <SelectItem key={i.installationId} value={String(i.installationId)}>
                                {i.accountLogin} ({i.accountType})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder="Filter repos"
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                        />
                        <Select
                          value={repoFullName}
                          onValueChange={(v) => {
                            setRepoFullName(v);
                            setTreePath("");
                            setSelectedGhPath("");
                            if (!name) setName(v.split("/").pop() || v);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select repository" />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredRepos.slice(0, 100).map((r) => (
                              <SelectItem key={r.id} value={r.fullName}>
                                {r.fullName}
                                {r.private ? " (private)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {repoFullName ? (
                          <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-border/60 p-2 text-sm">
                            {treePath ? (
                              <button
                                type="button"
                                className="block w-full text-left text-xs text-primary"
                                onClick={() => {
                                  const parts = treePath.split("/").filter(Boolean);
                                  parts.pop();
                                  setTreePath(parts.join("/"));
                                  setSelectedGhPath("");
                                }}
                              >
                                ← up
                              </button>
                            ) : null}
                            {treeEntries.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No tabular files found</p>
                            ) : (
                              treeEntries.map((e) => (
                                <button
                                  key={e.path}
                                  type="button"
                                  className={cn(
                                    "block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent",
                                    selectedGhPath === e.path && "bg-accent",
                                  )}
                                  onClick={() => {
                                    if (e.type === "dir") {
                                      setTreePath(e.path);
                                      setSelectedGhPath(e.path);
                                    } else if (e.ingestible !== false) {
                                      setSelectedGhPath(e.path);
                                    }
                                  }}
                                >
                                  {e.type === "dir" ? "[dir] " : ""}
                                  {e.path}
                                </button>
                              ))
                            )}
                          </div>
                        ) : null}
                        {selectedGhPath ? (
                          <p className="text-xs text-muted-foreground">
                            Selected: <code className="text-[11px]">{selectedGhPath}</code>
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3 rounded-md border border-border/70 p-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        {hfStatus?.connected
                          ? `Connected${hfStatus.login ? ` as ${hfStatus.login}` : ""}`
                          : hfStatus?.configured === false
                            ? "HF OAuth not configured"
                            : "Not connected"}
                      </span>
                      {hfStatus?.connected ? (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                          onClick={() => void disconnectHf()}
                        >
                          Disconnect
                        </button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={connectBusy || hfStatus?.configured === false}
                          onClick={() => void connectHf()}
                        >
                          Connect Hugging Face
                        </Button>
                      )}
                    </div>
                    {hfStatus?.connected ? (
                      <>
                        <Input
                          placeholder="Search datasets"
                          value={hfSearch}
                          onChange={(e) => setHfSearch(e.target.value)}
                        />
                        <Select
                          value={selectedHfId}
                          onValueChange={(v) => {
                            setSelectedHfId(v);
                            if (!name) setName(v.split("/").pop() || v);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select dataset" />
                          </SelectTrigger>
                          <SelectContent>
                            {hfDatasets.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.id}
                                {d.private ? " (private)" : ""}
                                {d.gated ? " (gated)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Revision (main)"
                            value={hfRevision}
                            onChange={(e) => setHfRevision(e.target.value)}
                          />
                          <Input
                            placeholder="Path (optional)"
                            value={hfPath}
                            onChange={(e) => setHfPath(e.target.value)}
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Textarea
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Input
              placeholder="Tags (comma-separated)"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <Select value={visibility} onValueChange={setVisibility}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">public</SelectItem>
                <SelectItem value="private">private</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Partition hint (optional)"
                value={partitionHint}
                onChange={(e) => setPartitionHint(e.target.value)}
              />
              <Input
                placeholder="Primary sort column"
                value={sortColumn}
                onChange={(e) => setSortColumn(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? statusHint || "Starting…" : "Start ingest"}
            </Button>
            {statusHint ? <p className="text-xs text-muted-foreground">{statusHint}</p> : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
