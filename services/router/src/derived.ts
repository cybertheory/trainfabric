/** Derived dataset policy + DAG validation. */

import type {
  DerivedSpec,
  MaterializationDecision,
  QueryRequest,
  Visibility,
} from "@trainfabric/shared";
import type { DatasetRecord, ResolverDeps, Identity } from "./resolver";
import { resolveQuery } from "./resolver";

export function detectCycle(
  newId: string,
  spec: DerivedSpec,
  getSources: (id: string) => string[] | undefined,
): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const srcs = id === newId ? spec.sources.map((s) => s.datasetId) : (getSources(id) ?? []);
    for (const s of srcs) {
      if (dfs(s)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return dfs(newId);
}

export function visibilityAllowed(
  derivedVisibility: Visibility,
  sources: DatasetRecord[],
): boolean {
  if (derivedVisibility === "private") return true;
  // public derived cannot point at private sources
  return sources.every((s) => s.visibility === "public");
}

/**
 * auto materialization policy (§14.3):
 * - whole spec Case A → pointer
 * - any Case B + non-trivial → materialized
 */
export async function decideMaterialization(
  spec: DerivedSpec,
  identity: Identity | null,
  deps: ResolverDeps,
): Promise<MaterializationDecision> {
  if (spec.materialization === "pointer") {
    return { mode: "pointer", reason: "Forced pointer by publisher" };
  }
  if (spec.materialization === "materialized") {
    return { mode: "materialized", reason: "Forced materialize by publisher" };
  }

  // auto
  if (spec.combine.op === "join") {
    return {
      mode: "materialized",
      reason: "Join is Case B — materialize to avoid recompute on every read",
    };
  }
  if (spec.combine.op === "union" && spec.sources.length > 1) {
    return {
      mode: "materialized",
      reason: "Union of multiple sources requires merge — materialize",
    };
  }

  // single / trivial: estimate each source query
  let anyB = false;
  let totalBytes = 0;
  for (const src of spec.sources) {
    const req: QueryRequest = {
      ...src.query,
      datasetId: src.datasetId,
      snapshot: src.snapshotPin ?? src.query.snapshot,
    };
    const est = await resolveQuery(req, identity, deps, { estimateOnly: true });
    if ("costTier" in est) {
      if (est.costTier === "B") anyB = true;
      totalBytes += est.estimatedBytes;
    }
  }

  if (!anyB) {
    return {
      mode: "pointer",
      reason: "Spec resolves to Case A (projection/partition filter) — pointer avoids duplication",
    };
  }
  if (totalBytes > 10 * 1024 * 1024) {
    return {
      mode: "materialized",
      reason: "Case B with non-trivial estimated size — materialize for read efficiency",
    };
  }
  return {
    mode: "materialized",
    reason: "Case B compute required — materialize",
  };
}

/** Expand a pointer derived dataset into underlying source QueryRequests (memoized). */
export async function expandPointer(
  dataset: DatasetRecord,
  getDataset: (id: string) => Promise<DatasetRecord | null>,
  memo = new Map<string, QueryRequest[]>(),
): Promise<QueryRequest[]> {
  if (memo.has(dataset.id)) return memo.get(dataset.id)!;
  const spec = dataset.derivedSpec as DerivedSpec | undefined;
  if (!spec || dataset.kind !== "derived") {
    const reqs = [{ datasetId: dataset.id } satisfies QueryRequest];
    memo.set(dataset.id, reqs);
    return reqs;
  }
  // Only expand pointers; materialized behave as base
  const decision = dataset.materializationDecision;
  if (decision?.mode === "materialized") {
    const reqs = [{ datasetId: dataset.id } satisfies QueryRequest];
    memo.set(dataset.id, reqs);
    return reqs;
  }

  const out: QueryRequest[] = [];
  for (const src of spec.sources) {
    const child = await getDataset(src.datasetId);
    if (!child) throw new Error(`Missing source ${src.datasetId}`);
    if (child.kind === "derived") {
      const nested = await expandPointer(child, getDataset, memo);
      out.push(...nested);
    } else {
      out.push({
        ...src.query,
        datasetId: src.datasetId,
        snapshot: src.snapshotPin ?? src.query.snapshot,
      });
    }
  }
  memo.set(dataset.id, out);
  return out;
}
