"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const UPLOAD_URL = "/api/proxy/datasets";

export default function NewDatasetPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [partitionHint, setPartitionHint] = useState("");
  const [sortColumn, setSortColumn] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) {
      setFile(f);
      if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
    }
  }, [name]);

  useEffect(() => {
    if (!jobId) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/proxy/jobs/${jobId}`);
        const job = await res.json();
        setStatus(job.status);
        setProgress(job.progress ?? (job.status === "done" ? 100 : 40));
        if (job.status === "done") {
          clearInterval(iv);
          toast.success("Ingest complete");
          router.push("/me");
        }
        if (job.status === "error") {
          clearInterval(iv);
          toast.error(job.error ?? "Ingest failed");
        }
      } catch {
        /* ignore poll errors */
      }
    }, 1500);
    return () => clearInterval(iv);
  }, [jobId, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error("Choose a file");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("name", name);
    form.append("description", description);
    form.append("tags", tags);
    form.append("visibility", visibility);
    if (partitionHint) form.append("partition_hint", partitionHint);
    if (sortColumn) form.append("sort_column", sortColumn);

    try {
      const res = await fetch(UPLOAD_URL, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { datasetId: string; jobId: string };
      setJobId(json.jobId);
      setStatus("pending");
      toast.message(`Ingest started · ${json.datasetId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Publish dataset</h1>
        <p className="text-muted-foreground">
          Upload CSV, JSON, or Parquet. We infer schema, write Iceberg Parquet to R2, and register a
          snapshot.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>File & metadata</CardTitle>
          <CardDescription>Public datasets appear on the index; private are owner-only.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
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
                accept=".csv,.json,.parquet,.parq"
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
            <Button type="submit" disabled={!!jobId}>
              Start ingest
            </Button>
          </form>
          {jobId ? (
            <div className="mt-6 space-y-2">
              <p className="text-sm">
                Job <code>{jobId}</code> · {status}
              </p>
              <Progress value={progress} />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
