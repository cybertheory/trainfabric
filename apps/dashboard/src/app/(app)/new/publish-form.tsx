"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJobTracker } from "@/lib/job-tracker";
import { publicApiOrigin } from "@/lib/api";
import { cn } from "@/lib/utils";

export type TokenGetter = () => Promise<string | null>;

type SourceMode = "upload" | "link";

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
  const { trackJob } = useJobTracker();
  const [sourceMode, setSourceMode] = useState<SourceMode>("upload");
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

    setSubmitting(true);
    setStatusHint(sourceMode === "link" ? "Finding files…" : "Uploading…");

    try {
      const token = await getToken();
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);

      let json: { datasetId: string; jobId: string; source?: string };

      if (sourceMode === "link") {
        headers.set("Content-Type", "application/json");
        const res = await fetch(`${publicApiOrigin()}/datasets`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            source_url: sourceUrl.trim(),
            name: name || undefined,
            description: description || undefined,
            tags: tags || undefined,
            visibility,
            partition_hint: partitionHint || undefined,
            sort_column: sortColumn || undefined,
          }),
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

      trackJob({
        jobId: json.jobId,
        datasetId: json.datasetId,
        name: name || file?.name || sourceUrl.trim().split("/").filter(Boolean).pop() || "dataset",
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
          Upload a file or import from a public Hugging Face / GitHub link. After ingest starts you
          return to Home — watch progress in the header.
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
              <button
                type="button"
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  sourceMode === "upload"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setSourceMode("upload")}
              >
                <Upload className="h-4 w-4" />
                Upload
              </button>
              <button
                type="button"
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  sourceMode === "link"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setSourceMode("link")}
              >
                <Link2 className="h-4 w-4" />
                From link
              </button>
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
            ) : (
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
                  Paste a public Hugging Face or GitHub link to a file or folder. We&apos;ll pull{" "}
                  <code className="text-[11px]">.parquet</code>,{" "}
                  <code className="text-[11px]">.csv</code>,{" "}
                  <code className="text-[11px]">.json</code>, and{" "}
                  <code className="text-[11px]">.jsonl</code> files (folders are searched
                  recursively).
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
            )}

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
