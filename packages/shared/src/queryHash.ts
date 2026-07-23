/**
 * Stable query-hash — the result-cache keystone.
 *
 * Hash = SHA-256 of:
 *   datasetId + resolvedSnapshotId + sorted(columns) + normalizedFilter + limit
 *
 * Filter normalization:
 * - trim whitespace
 * - collapse internal whitespace to single spaces
 * - lowercase keywords AND/OR/NOT (keeps identifiers case-sensitive)
 * - split top-level AND clauses and sort them so `a AND b` == `b AND a`
 *
 * Nested parentheses / OR-only expressions are normalized for whitespace only;
 * AND-clause reordering only applies to flat conjunctions (documented + tested).
 */

import type { QueryRequest } from "./types.js";

const AND_SPLIT = /\s+AND\s+/i;

/** Normalize a SQL-ish filter for stable hashing. */
export function normalizeFilter(filter: string | undefined | null): string {
  if (!filter) return "";
  let s = filter.trim().replace(/\s+/g, " ");
  // lowercase boolean keywords while preserving identifier case elsewhere
  s = s.replace(/\b(and|or|not)\b/gi, (m) => m.toUpperCase());

  // Flat conjunction: split on top-level AND (no paren nesting), sort clauses
  if (!s.includes("(") && AND_SPLIT.test(s)) {
    const parts = s
      .split(AND_SPLIT)
      .map((p) => p.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return parts.join(" AND ");
  }
  return s;
}

/** Canonical column list for hashing. */
export function normalizeColumns(columns: string[] | undefined | null): string[] {
  if (!columns || columns.length === 0) return [];
  return [...columns].map((c) => c.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export interface QueryHashInput {
  datasetId: string;
  snapshotId: string;
  columns?: string[];
  filter?: string;
  limit?: number;
  branch?: string;
}

/** Build the canonical string that is hashed. Exported for tests. */
export function canonicalQueryString(input: QueryHashInput): string {
  const cols = normalizeColumns(input.columns);
  const filter = normalizeFilter(input.filter);
  const limit = input.limit ?? "";
  const branch = input.branch ?? "main";
  return [
    input.datasetId,
    input.snapshotId,
    branch,
    cols.join(","),
    filter,
    String(limit),
  ].join("|");
}

/** SHA-256 hex digest (Web Crypto). */
export async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const subtle = globalThis.crypto.subtle;
  const buf = await subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compute the stable query hash used as the result-cache key. */
export async function queryHash(input: QueryHashInput): Promise<string> {
  return sha256Hex(canonicalQueryString(input));
}

/** Convenience: hash a QueryRequest with an already-resolved snapshot id. */
export async function hashQueryRequest(
  req: QueryRequest,
  resolvedSnapshotId: string,
): Promise<string> {
  return queryHash({
    datasetId: req.datasetId,
    snapshotId: resolvedSnapshotId,
    columns: req.columns,
    filter: req.filter,
    limit: req.limit,
    branch: req.branch,
  });
}
