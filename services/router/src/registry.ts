/** Unified control-plane client: D1 (Cloudflare) or Convex HTTP. */

import type { ConvexClient } from "./convex";
import { createConvexClient } from "./convex";
import { createD1Registry } from "./d1";

export type Registry = ConvexClient & { seedDemo?: () => Promise<void> };

export function createRegistry(env: {
  DB?: D1Database;
  CONVEX_URL?: string;
  CONVEX_SERVICE_KEY?: string;
}): Registry {
  if (env.DB) {
    const d1 = createD1Registry(env.DB);
    return {
      lookupCache: (queryHash) => d1.lookupCache(queryHash),
      upsertCache: async (body) => {
        await d1.upsertCache(body as Parameters<typeof d1.upsertCache>[0]);
      },
      getDataset: (id) => d1.getDataset(id),
      listDatasets: async (body) =>
        d1.listDatasets(body as Parameters<typeof d1.listDatasets>[0]),
      createDataset: async (body) => {
        await d1.createDataset(body as Parameters<typeof d1.createDataset>[0]);
      },
      updateAfterIngest: async (body) => {
        await d1.updateAfterIngest(body as Parameters<typeof d1.updateAfterIngest>[0]);
      },
      setJob: async (body) => {
        await d1.setJob(body as Parameters<typeof d1.setJob>[0]);
      },
      getJob: (id) => d1.getJob(id),
      seedDemo: () => d1.seedDemo(),
    };
  }

  if (!env.CONVEX_URL || !env.CONVEX_SERVICE_KEY) {
    throw new Error("Configure DB (D1) or CONVEX_URL + CONVEX_SERVICE_KEY");
  }
  return createConvexClient(env.CONVEX_URL, env.CONVEX_SERVICE_KEY);
}
