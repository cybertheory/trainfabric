/** Convex HTTP client for the Worker (service-key auth). */

export interface ConvexClient {
  lookupCache(queryHash: string): Promise<unknown>;
  upsertCache(body: Record<string, unknown>): Promise<void>;
  getDataset(id: string): Promise<unknown>;
  listDatasets(body: Record<string, unknown>): Promise<unknown>;
  createDataset(body: Record<string, unknown>): Promise<void>;
  updateAfterIngest(body: Record<string, unknown>): Promise<void>;
  setJob(body: Record<string, unknown>): Promise<void>;
  getJob(id: string): Promise<unknown>;
}

export function createConvexClient(baseUrl: string, serviceKey: string): ConvexClient {
  const headers = {
    "content-type": "application/json",
    "x-service-key": serviceKey,
  };

  async function post(path: string, body: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Convex ${path} failed: ${res.status} ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    lookupCache: (queryHash) => post("/api/cache/lookup", { queryHash }),
    upsertCache: async (body) => {
      await post("/api/cache/upsert", body);
    },
    getDataset: (id) => post("/api/datasets/get", { id }),
    listDatasets: (body) => post("/api/datasets/list", body),
    createDataset: async (body) => {
      await post("/api/datasets/create", body);
    },
    updateAfterIngest: async (body) => {
      await post("/api/datasets/update-ingest", body);
    },
    setJob: async (body) => {
      await post("/api/jobs/set", body);
    },
    getJob: (id) => post("/api/jobs/get", { id }),
  };
}
