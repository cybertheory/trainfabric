"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJobTracker } from "@/lib/job-tracker";
import { publicApiOrigin } from "@/lib/api";

export type TokenGetter = () => Promise<string | null>;

export function PublishForm({ getToken }: { getToken: TokenGetter }) {
  const router = useRouter();
  const { trackJob } = useJobTracker();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [partitionHint, setPartitionHint] = useState("");
  const [sortColumn, setSortColumn] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
    if (!file) {
      toast.error("Choose a file");
      return;
    }
    setSubmitting(true);
    const form = new FormData();
    form.append("file", file);
    form.append("name", name);
    form.append("description", description);
    form.append("tags", tags);
    form.append("visibility", visibility);
    if (partitionHint) form.append("partition_hint", partitionHint);
    if (sortColumn) form.append("sort_column", sortColumn);

    try {
      const token = await getToken();
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);

      const res = await fetch(`${publicApiOrigin()}/datasets`, {
        method: "POST",
        body: form,
        headers,
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { datasetId: string; jobId: string };
      trackJob({
        jobId: json.jobId,
        datasetId: json.datasetId,
        name: name || file.name,
      });
      toast.message("Ingest started — tracking in the activity drawer");
      router.push("/datasets");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Publish dataset</h1>
        <p className="text-muted-foreground">
          Upload CSV, JSON, or Parquet. After you start ingest you&apos;ll return to Datasets — watch
          progress in the header and get notified when it finishes.
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
            <Button type="submit" disabled={submitting}>
              {submitting ? "Starting…" : "Start ingest"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
