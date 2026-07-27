/**
 * Resolve Hugging Face / GitHub URLs to downloadable tabular files.
 * Folders are walked recursively. Pass tokens for private/gated sources.
 */

export const REMOTE_EXTS = [".parquet", ".parq", ".csv", ".json", ".jsonl", ".ndjson"] as const;

export const MAX_REMOTE_FILES = 50;
export const MAX_REMOTE_BYTES = 500 * 1024 * 1024;

export type RemoteKind = "hf" | "github";

export type RemoteAuth = {
  githubToken?: string;
  hfToken?: string;
};

export type ParsedRemote =
  | {
      kind: "hf";
      repoId: string; // owner/name
      revision: string;
      path: string; // "" = repo root
      isFileHint: boolean;
    }
  | {
      kind: "github";
      owner: string;
      repo: string;
      ref: string;
      path: string;
      isFileHint: boolean;
      raw?: boolean;
    };

export type RemoteFile = {
  path: string;
  downloadUrl: string;
  size?: number;
};

export class RemoteSourceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "RemoteSourceError";
  }
}

function hasAllowedExt(path: string): boolean {
  const lower = path.toLowerCase();
  return REMOTE_EXTS.some((e) => lower.endsWith(e));
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "") === u.origin ? u.toString() : u.href.replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

function authHeaders(auth?: RemoteAuth, kind?: RemoteKind): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": "trainfabric-router" };
  if (kind === "github" && auth?.githubToken) {
    h.Authorization = `Bearer ${auth.githubToken}`;
    h.Accept = "application/vnd.github+json";
  } else if (kind === "hf" && auth?.hfToken) {
    h.Authorization = `Bearer ${auth.hfToken}`;
  }
  return h;
}

function forbiddenMessage(kind: RemoteKind, hadToken: boolean): string {
  if (hadToken) {
    return kind === "hf"
      ? "Hugging Face denied access — check the dataset is shared with your account, or reconnect HF."
      : "GitHub denied access — install the Trainfabric GitHub App on that repo, or reconnect GitHub.";
  }
  return kind === "hf"
    ? "This Hugging Face dataset is private or gated — connect Hugging Face and try again."
    : "This GitHub path is private — connect GitHub (App install) and try again.";
}

/** Parse a user-pasted HF or GitHub URL. */
export function parseSourceUrl(raw: string): ParsedRemote {
  let href = raw.trim();
  if (!href) throw new RemoteSourceError("Paste a Hugging Face or GitHub URL");

  let u: URL;
  try {
    if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
    u = new URL(href);
  } catch {
    throw new RemoteSourceError("Paste a valid Hugging Face or GitHub URL");
  }

  const host = u.hostname.toLowerCase();

  if (host === "raw.githubusercontent.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 4) {
      throw new RemoteSourceError("Invalid raw.githubusercontent.com URL");
    }
    const [owner, repo, ref, ...rest] = parts;
    return {
      kind: "github",
      owner: owner!,
      repo: repo!,
      ref: ref!,
      path: rest.join("/"),
      isFileHint: true,
      raw: true,
    };
  }

  if (host === "github.com" || host === "www.github.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new RemoteSourceError("Invalid GitHub URL");
    const [owner, repo, kind, ref, ...rest] = parts;
    if (!kind) {
      return {
        kind: "github",
        owner: owner!,
        repo: repo!,
        ref: "main",
        path: "",
        isFileHint: false,
      };
    }
    if (kind !== "tree" && kind !== "blob") {
      throw new RemoteSourceError("Use a github.com file or folder link (tree/ or blob/)");
    }
    if (!ref) throw new RemoteSourceError("Invalid GitHub URL — missing branch");
    return {
      kind: "github",
      owner: owner!,
      repo: repo!,
      ref,
      path: rest.join("/"),
      isFileHint: kind === "blob",
    };
  }

  if (host === "huggingface.co" || host === "www.huggingface.co" || host === "hf.co") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] !== "datasets" || parts.length < 3) {
      throw new RemoteSourceError("Use a huggingface.co/datasets/... link");
    }
    const repoId = `${parts[1]}/${parts[2]}`;
    const kind = parts[3];
    if (!kind) {
      return { kind: "hf", repoId, revision: "main", path: "", isFileHint: false };
    }
    if (kind === "tree" || kind === "blob" || kind === "resolve") {
      const revision = parts[4] ?? "main";
      const path = parts.slice(5).join("/");
      return {
        kind: "hf",
        repoId,
        revision,
        path,
        isFileHint: kind === "blob" || kind === "resolve",
      };
    }
    return {
      kind: "hf",
      repoId,
      revision: "main",
      path: parts.slice(3).join("/"),
      isFileHint: hasAllowedExt(parts[parts.length - 1] ?? ""),
    };
  }

  throw new RemoteSourceError("Use a huggingface.co or github.com link");
}

async function fetchJson<T>(
  url: string,
  kind: RemoteKind,
  auth?: RemoteAuth,
  init?: RequestInit,
): Promise<T> {
  const hadToken = kind === "github" ? Boolean(auth?.githubToken) : Boolean(auth?.hfToken);
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...authHeaders(auth, kind),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const bodyText = await res.text().catch(() => "");
    if (
      remaining === "0" ||
      /rate.?limit/i.test(bodyText) ||
      /API rate limit exceeded/i.test(bodyText)
    ) {
      throw new RemoteSourceError(
        "GitHub rate limit exceeded — try again in a few minutes, or paste a raw/file URL",
        429,
      );
    }
    throw new RemoteSourceError(forbiddenMessage(kind, hadToken), 403);
  }
  if (res.status === 404) {
    throw new RemoteSourceError(
      hadToken
        ? "Could not find that repository or path."
        : "Could not find that repository or path (is it public?).",
      404,
    );
  }
  if (!res.ok) {
    throw new RemoteSourceError(`Could not reach source (${res.status})`, 502);
  }
  return res.json() as Promise<T>;
}

type GhContent =
  | { type: "file"; path: string; size: number; download_url: string | null }
  | { type: "dir"; path: string }
  | { type: string; path: string };

async function listGithub(
  parsed: Extract<ParsedRemote, { kind: "github" }>,
  auth?: RemoteAuth,
): Promise<RemoteFile[]> {
  if (parsed.raw || (parsed.isFileHint && hasAllowedExt(parsed.path))) {
    const downloadUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.ref}/${parsed.path}`;
    if (!hasAllowedExt(parsed.path)) {
      throw new RemoteSourceError(
        "No .parquet / .csv / .json / .jsonl files found at that path",
      );
    }
    return [{ path: parsed.path, downloadUrl }];
  }

  try {
    return await listGithubViaApi(parsed, auth);
  } catch (e) {
    if (
      !auth?.githubToken &&
      e instanceof RemoteSourceError &&
      (e.status === 429 || e.status === 502 || e.status === 403)
    ) {
      const viaCdn = await listGithubViaJsDelivr(parsed).catch(() => null);
      if (viaCdn?.length) return viaCdn;
    }
    throw e;
  }
}

async function listGithubViaApi(
  parsed: Extract<ParsedRemote, { kind: "github" }>,
  auth?: RemoteAuth,
): Promise<RemoteFile[]> {
  const refMeta = await fetchJson<{ object?: { sha?: string }; sha?: string }>(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/ref/heads/${encodeURIComponent(parsed.ref)}`,
    "github",
    auth,
  ).catch(async () => {
    return fetchJson<{ object?: { sha?: string }; sha?: string }>(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(parsed.ref)}`,
      "github",
      auth,
    );
  });

  const sha = refMeta.object?.sha ?? refMeta.sha;
  if (!sha) {
    return listGithubContentsRecursive(parsed, auth);
  }

  const tree = await fetchJson<{
    tree: { path: string; type: string; size?: number; url?: string }[];
    truncated?: boolean;
  }>(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${sha}?recursive=1`,
    "github",
    auth,
  );

  const prefix = parsed.path ? parsed.path.replace(/\/$/, "") : "";
  const files: RemoteFile[] = [];
  for (const node of tree.tree) {
    if (node.type !== "blob") continue;
    if (!hasAllowedExt(node.path)) continue;
    if (prefix && node.path !== prefix && !node.path.startsWith(prefix + "/")) continue;
    files.push({
      path: node.path,
      downloadUrl: `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.ref}/${node.path}`,
      size: node.size,
    });
    if (files.length >= MAX_REMOTE_FILES) break;
  }
  return files;
}

async function listGithubViaJsDelivr(
  parsed: Extract<ParsedRemote, { kind: "github" }>,
): Promise<RemoteFile[]> {
  const url = `https://data.jsdelivr.com/v1/packages/gh/${parsed.owner}/${parsed.repo}@${encodeURIComponent(parsed.ref)}/flat`;
  const data = await fetchJson<{ files?: { name: string; size?: number }[] }>(url, "github");
  const prefix = parsed.path ? `/${parsed.path.replace(/\/$/, "")}` : "";
  const files: RemoteFile[] = [];
  for (const f of data.files ?? []) {
    const path = f.name.replace(/^\//, "");
    if (!hasAllowedExt(path)) continue;
    if (prefix) {
      const want = prefix.slice(1);
      if (path !== want && !path.startsWith(want + "/")) continue;
    }
    files.push({
      path,
      downloadUrl: `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.ref}/${path}`,
      size: f.size,
    });
    if (files.length >= MAX_REMOTE_FILES) break;
  }
  return files;
}

async function listGithubContentsRecursive(
  parsed: Extract<ParsedRemote, { kind: "github" }>,
  auth?: RemoteAuth,
  dirPath = parsed.path,
): Promise<RemoteFile[]> {
  const q = dirPath
    ? `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${dirPath}?ref=${encodeURIComponent(parsed.ref)}`
    : `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents?ref=${encodeURIComponent(parsed.ref)}`;
  const data = await fetchJson<GhContent | GhContent[]>(q, "github", auth);
  const entries = Array.isArray(data) ? data : [data];
  const out: RemoteFile[] = [];

  for (const e of entries) {
    if (out.length >= MAX_REMOTE_FILES) break;
    if (e.type === "file" && hasAllowedExt(e.path)) {
      const file = e as Extract<GhContent, { type: "file" }>;
      if (!file.download_url) continue;
      out.push({ path: file.path, downloadUrl: file.download_url, size: file.size });
    } else if (e.type === "dir") {
      const nested = await listGithubContentsRecursive(parsed, auth, e.path);
      out.push(...nested);
    }
  }
  return out.slice(0, MAX_REMOTE_FILES);
}

type HfTreeNode = {
  type: "file" | "directory";
  path: string;
  size?: number;
  oid?: string;
};

async function listHf(
  parsed: Extract<ParsedRemote, { kind: "hf" }>,
  auth?: RemoteAuth,
): Promise<RemoteFile[]> {
  if (parsed.isFileHint && hasAllowedExt(parsed.path)) {
    return [
      {
        path: parsed.path,
        downloadUrl: `https://huggingface.co/datasets/${parsed.repoId}/resolve/${parsed.revision}/${parsed.path}`,
      },
    ];
  }

  const pathParam = parsed.path ? `&path=${encodeURIComponent(parsed.path)}` : "";
  const url = `https://huggingface.co/api/datasets/${parsed.repoId}/tree/${encodeURIComponent(parsed.revision)}?recursive=1${pathParam}`;
  const nodes = await fetchJson<HfTreeNode[]>(url, "hf", auth);

  const prefix = parsed.path ? parsed.path.replace(/\/$/, "") : "";
  const files: RemoteFile[] = [];
  for (const n of nodes) {
    if (n.type !== "file") continue;
    if (!hasAllowedExt(n.path)) continue;
    if (prefix && n.path !== prefix && !n.path.startsWith(prefix + "/")) continue;
    files.push({
      path: n.path,
      downloadUrl: `https://huggingface.co/datasets/${parsed.repoId}/resolve/${parsed.revision}/${n.path}`,
      size: n.size,
    });
    if (files.length >= MAX_REMOTE_FILES) break;
  }
  return files;
}

/** List matching tabular files under an HF/GitHub URL (recursive). */
export async function listRemoteFiles(
  sourceUrl: string,
  auth?: RemoteAuth,
): Promise<{
  kind: RemoteKind;
  files: RemoteFile[];
  truncated: boolean;
}> {
  const parsed = parseSourceUrl(sourceUrl);
  const files =
    parsed.kind === "hf" ? await listHf(parsed, auth) : await listGithub(parsed, auth);

  if (!files.length) {
    throw new RemoteSourceError(
      "No .parquet / .csv / .json / .jsonl files found at that path",
    );
  }

  const byExt = (p: string) => {
    const l = p.toLowerCase();
    if (l.endsWith(".parquet") || l.endsWith(".parq")) return "parquet";
    if (l.endsWith(".csv")) return "csv";
    return "json";
  };
  const families = new Set(files.map((f) => byExt(f.path)));
  let selected = files;
  if (families.size > 1) {
    const order = ["parquet", "csv", "json"] as const;
    const pick = order.find((f) => files.some((x) => byExt(x.path) === f))!;
    selected = files.filter((f) => byExt(f.path) === pick);
  }

  const ordered = [...selected].sort((a, b) => (a.size ?? 0) - (b.size ?? 0));

  let total = 0;
  const capped: RemoteFile[] = [];
  for (const f of ordered) {
    const sz = f.size ?? 0;
    if (total + sz > MAX_REMOTE_BYTES && capped.length > 0) break;
    if (sz > MAX_REMOTE_BYTES) {
      throw new RemoteSourceError(
        `File ${f.path} exceeds the ${MAX_REMOTE_BYTES / (1024 * 1024)}MB limit`,
      );
    }
    capped.push(f);
    total += sz;
    if (capped.length >= MAX_REMOTE_FILES) break;
  }

  return {
    kind: parsed.kind,
    files: capped,
    truncated: capped.length < selected.length || files.length > selected.length,
  };
}

export function contentTypeForPath(path: string): string {
  const l = path.toLowerCase();
  if (l.endsWith(".parquet") || l.endsWith(".parq")) return "application/octet-stream";
  if (l.endsWith(".json") || l.endsWith(".jsonl") || l.endsWith(".ndjson")) return "application/json";
  return "text/csv";
}

/** Download remote files into R2 under staging/{datasetId}/… */
export async function downloadRemoteToR2(
  r2: {
    put(
      key: string,
      value: ArrayBuffer | ReadableStream | string,
      opts?: { httpMetadata?: { contentType?: string } },
    ): Promise<unknown>;
  },
  datasetId: string,
  files: RemoteFile[],
  bucket = "trainfabric-data",
  auth?: RemoteAuth,
  kind: RemoteKind = "github",
): Promise<{ stagingPath: string; fileCount: number; bytes: number }> {
  let bytes = 0;
  const keys: string[] = [];
  const hadToken =
    kind === "github" ? Boolean(auth?.githubToken) : Boolean(auth?.hfToken);

  for (const f of files) {
    const known = f.size ?? 0;
    if (known > 0 && bytes + known > MAX_REMOTE_BYTES && keys.length > 0) {
      break;
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 120_000);
    let res: Response;
    try {
      res = await fetch(f.downloadUrl, {
        headers: authHeaders(auth, kind),
        signal: abort.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const msg =
        e instanceof Error && e.name === "AbortError"
          ? `Timed out downloading ${f.path}`
          : e instanceof Error
            ? e.message
            : String(e);
      throw new RemoteSourceError(msg, 502);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      throw new RemoteSourceError(forbiddenMessage(kind, hadToken), 403);
    }
    if (!res.ok) {
      throw new RemoteSourceError(`Failed to download ${f.path} (${res.status})`, 502);
    }

    const contentLen = Number(res.headers.get("content-length") || "0");
    const fileBytes = known || contentLen;
    if (fileBytes > MAX_REMOTE_BYTES) {
      throw new RemoteSourceError(
        `File ${f.path} exceeds the ${MAX_REMOTE_BYTES / (1024 * 1024)}MB limit`,
      );
    }
    if (fileBytes > 0 && bytes + fileBytes > MAX_REMOTE_BYTES && keys.length > 0) {
      break;
    }

    const safeName = f.path
      .replace(/^\/+/, "")
      .replace(/\.\./g, "_")
      .replace(/[/\\]/g, "__");
    const key = `staging/${datasetId}/${safeName}`;
    const contentType = contentTypeForPath(f.path);

    if (fileBytes > 0 && res.body) {
      const { readable, writable } = new FixedLengthStream(fileBytes);
      void res.body.pipeTo(writable).catch(() => {
        /* length mismatch / abort — put will fail */
      });
      await r2.put(key, readable, { httpMetadata: { contentType } });
      bytes += fileBytes;
    } else {
      const buf = await res.arrayBuffer();
      bytes += buf.byteLength;
      if (bytes > MAX_REMOTE_BYTES && keys.length > 0) {
        break;
      }
      if (buf.byteLength > MAX_REMOTE_BYTES) {
        throw new RemoteSourceError(
          `File ${f.path} exceeds the ${MAX_REMOTE_BYTES / (1024 * 1024)}MB limit`,
        );
      }
      await r2.put(key, buf, { httpMetadata: { contentType } });
    }
    keys.push(key);
  }

  if (!keys.length) {
    throw new RemoteSourceError("No files could be downloaded within the size limit");
  }

  if (keys.length === 1) {
    return {
      stagingPath: `s3://${bucket}/${keys[0]}`,
      fileCount: 1,
      bytes,
    };
  }

  return {
    stagingPath: `s3://${bucket}/staging/${datasetId}/`,
    fileCount: keys.length,
    bytes,
  };
}

export { stripQuery, hasAllowedExt };
