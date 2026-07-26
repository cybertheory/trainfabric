/** Compute container HTTP client. */

import type { QueryRequest } from "@trainfabric/shared";
import type { ComputeQueryResult, ScanPlan } from "./resolver";
import { getContainer } from "@cloudflare/containers";
import type { ComputeContainer } from "./ComputeContainer";

export interface ComputeClient {
  ingest(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  scanPlan(req: QueryRequest & { namespace?: string }): Promise<ScanPlan>;
  query(req: QueryRequest & { namespace?: string; queryHash: string }): Promise<ComputeQueryResult>;
  sample(datasetId: string, n: number, namespace?: string): Promise<Record<string, unknown>[]>;
  snapshots(datasetId: string, namespace?: string): Promise<unknown[]>;
  prompt(body: {
    prompt: string;
    dataset_id: string;
    namespace?: string;
    execute?: boolean;
    snapshot?: string;
    max_steps?: number;
  }): Promise<Record<string, unknown>>;
  health(): Promise<boolean>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function makeClient(doFetch: FetchLike): ComputeClient {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await doFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Compute ${path}: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    ingest: (body) => post("/ingest", body),
    scanPlan: async (req) => {
      const raw = await post<{
        case: "A" | "B";
        matchedFiles: string[];
        estimatedRows: number;
        estimatedBytes: number;
        manifest?: ScanPlan["manifest"];
        reason: string;
        partitionColumns: string[];
      }>("/scan-plan", {
        dataset_id: req.datasetId,
        namespace: req.namespace ?? "default",
        columns: req.columns,
        filter: req.filter,
        snapshot: req.snapshot,
      });
      return raw;
    },
    query: async (req) => {
      const raw = await post<{
        mode: "stream" | "link";
        arrowBase64?: string;
        r2Path?: string;
        rowCount: number;
        sizeBytes: number;
      }>("/query", {
        dataset_id: req.datasetId,
        namespace: req.namespace ?? "default",
        columns: req.columns,
        filter: req.filter,
        snapshot: req.snapshot,
        limit: req.limit,
        query_hash: req.queryHash,
        mode: req.mode,
      });
      return raw;
    },
    sample: async (datasetId, n, namespace = "default") => {
      const raw = await post<{ rows: Record<string, unknown>[] }>("/sample", {
        dataset_id: datasetId,
        n,
        namespace,
      });
      return raw.rows;
    },
    snapshots: async (datasetId, namespace = "default") => {
      const res = await doFetch(
        `/snapshots/${encodeURIComponent(datasetId)}?namespace=${namespace}`,
      );
      if (!res.ok) throw new Error(`snapshots: ${res.status}`);
      const raw = (await res.json()) as { snapshots: unknown[] };
      return raw.snapshots;
    },
    prompt: (body) => post("/prompt", body),
    health: async () => {
      const res = await doFetch("/health");
      return res.ok;
    },
  };
}

export function createComputeClient(baseUrl: string): ComputeClient {
  return makeClient((path, init) => {
    const headers = new Headers(init?.headers);
    if (baseUrl.includes("ngrok") && !headers.has("ngrok-skip-browser-warning")) {
      headers.set("ngrok-skip-browser-warning", "1");
    }
    return fetch(`${baseUrl}${path}`, { ...init, headers });
  });
}

/** Prefer COMPUTE_URL (tunnel/local) when set; else Cloudflare Container binding. */
export function createComputeClientFromEnv(env: {
  COMPUTE?: DurableObjectNamespace<ComputeContainer>;
  COMPUTE_URL?: string;
}): ComputeClient {
  if (env.COMPUTE_URL) {
    return createComputeClient(env.COMPUTE_URL);
  }
  if (env.COMPUTE) {
    return makeClient(async (path, init) => {
      // Named instance so AI Gateway secret/env rollouts start a fresh container.
      const stub = getContainer(env.COMPUTE!, "hermes-aigw-v2");
      return stub.fetch(new Request(`http://compute${path}`, init));
    });
  }
  throw new Error("Configure COMPUTE binding or COMPUTE_URL");
}

/** Marker passed into CatalogDO when using the Container binding. */
export const CONTAINER_COMPUTE = "container://compute";
