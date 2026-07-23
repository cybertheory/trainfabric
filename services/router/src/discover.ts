/**
 * Semantic discovery via Workers AI embeddings + Vectorize.
 * Falls back to keyword ranking when AI/Vectorize unavailable.
 */

import type { DatasetMeta } from "@trainfabric/shared";

export interface DiscoverConstraints {
  tags?: string[];
  owner?: string;
  visibility?: "public" | "private";
}

export interface DiscoverHit {
  dataset: DatasetMeta;
  score: number;
  why: string;
}

type AiBinding = {
  run(
    model: string,
    input: { text: string[] },
  ): Promise<{ data: number[][] }>;
};

type VectorizeBinding = {
  query(
    vector: number[],
    opts: { topK: number; returnMetadata: boolean },
  ): Promise<{ matches: { id: string; score: number; metadata?: Record<string, string> }[] }>;
  upsert(
    vectors: { id: string; values: number[]; metadata?: Record<string, string | number> }[],
  ): Promise<unknown>;
};

const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

export async function embedText(ai: AiBinding | undefined, text: string): Promise<number[] | null> {
  if (!ai) return null;
  try {
    const out = await ai.run(EMBED_MODEL, { text: [text] });
    return out.data[0] ?? null;
  } catch {
    return null;
  }
}

export async function upsertDatasetEmbedding(
  ai: AiBinding | undefined,
  vectorize: VectorizeBinding | undefined,
  dataset: DatasetMeta & { schema?: { columns: { name: string }[] } },
): Promise<void> {
  if (!ai || !vectorize) return;
  const colNames = dataset.schema?.columns?.map((c) => c.name).join(" ") ?? "";
  const text = [dataset.name, dataset.description ?? "", dataset.tags.join(" "), colNames]
    .join(" ")
    .trim();
  const values = await embedText(ai, text);
  if (!values) return;
  await vectorize.upsert([
    {
      id: dataset.id,
      values,
      metadata: {
        datasetId: dataset.id,
        visibility: dataset.visibility,
        owner: dataset.owner,
        name: dataset.name,
      },
    },
  ]);
}

export async function discoverDatasets(
  intent: string,
  candidates: DatasetMeta[],
  constraints: DiscoverConstraints | undefined,
  identitySubject: string | undefined,
  ai?: AiBinding,
  vectorize?: VectorizeBinding,
): Promise<DiscoverHit[]> {
  let pool = candidates.filter((d) => {
    if (d.visibility === "private") {
      return identitySubject && d.owner === identitySubject;
    }
    return true;
  });
  if (constraints?.tags?.length) {
    const tags = constraints.tags.map((t) => t.toLowerCase());
    pool = pool.filter((d) => tags.every((t) => d.tags.map((x) => x.toLowerCase()).includes(t)));
  }
  if (constraints?.owner) {
    pool = pool.filter((d) => d.owner === constraints.owner);
  }

  // Keyword scores
  const intentLower = intent.toLowerCase();
  const terms = intentLower.split(/\s+/).filter(Boolean);
  const keywordHits = new Map<string, DiscoverHit>();
  for (const d of pool) {
    let score = 0;
    const why: string[] = [];
    if (d.name.toLowerCase().includes(intentLower) || intentLower.includes(d.name.toLowerCase())) {
      score += 5;
      why.push(`name matches "${d.name}"`);
    }
    for (const t of terms) {
      if (d.tags.some((tag) => tag.toLowerCase() === t)) {
        score += 3;
        why.push(`tag "${t}"`);
      }
      if (d.description?.toLowerCase().includes(t)) {
        score += 1;
      }
    }
    if (score > 0) {
      keywordHits.set(d.id, {
        dataset: d,
        score,
        why: why.length ? why.join("; ") : "keyword match",
      });
    }
  }

  // Semantic path
  const vec = await embedText(ai, intent);
  if (vec && vectorize) {
    try {
      const res = await vectorize.query(vec, { topK: 20, returnMetadata: true });
      const byId = new Map(pool.map((d) => [d.id, d]));
      for (const m of res.matches) {
        const meta = m.metadata ?? {};
        const vis = meta.visibility;
        const owner = meta.owner;
        if (vis === "private" && owner !== identitySubject) continue;
        const d = byId.get(m.id) ?? byId.get(String(meta.datasetId));
        if (!d) continue;
        const existing = keywordHits.get(d.id);
        const semScore = m.score * 10;
        if (!existing || semScore > existing.score) {
          keywordHits.set(d.id, {
            dataset: d,
            score: Math.max(semScore, existing?.score ?? 0),
            why: existing
              ? `${existing.why}; semantic similarity ${(m.score * 100).toFixed(0)}%`
              : `semantic match (${(m.score * 100).toFixed(0)}% similar to intent)`,
          });
        }
      }
    } catch {
      // fall through to keyword-only
    }
  }

  return [...keywordHits.values()].sort((a, b) => b.score - a.score).slice(0, 20);
}
