import { describe, expect, it } from "vitest";
import {
  canonicalQueryString,
  hashQueryRequest,
  normalizeColumns,
  normalizeFilter,
  queryHash,
} from "../src/queryHash.js";
import { FilterValidationError, validateFilter } from "../src/filter.js";

describe("normalizeFilter", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeFilter("  a = 1   AND   b = 2  ")).toBe("a = 1 AND b = 2");
  });

  it("sorts flat AND clauses so order does not matter", () => {
    expect(normalizeFilter("b = 2 AND a = 1")).toBe(normalizeFilter("a = 1 AND b = 2"));
  });

  it("uppercases boolean keywords", () => {
    expect(normalizeFilter("a = 1 and b = 2")).toBe("a = 1 AND b = 2");
  });

  it("does not reorder when parentheses are present", () => {
    const a = normalizeFilter("(a = 1 OR b = 2) AND c = 3");
    const b = normalizeFilter("c = 3 AND (a = 1 OR b = 2)");
    // With parens we only normalize whitespace/keywords — order may differ
    expect(a).not.toBe(b);
  });

  it("returns empty for nullish", () => {
    expect(normalizeFilter(undefined)).toBe("");
    expect(normalizeFilter(null)).toBe("");
    expect(normalizeFilter("")).toBe("");
  });
});

describe("normalizeColumns", () => {
  it("sorts and trims", () => {
    expect(normalizeColumns(["z", " a ", "m"])).toEqual(["a", "m", "z"]);
  });

  it("treats empty as all-columns sentinel", () => {
    expect(normalizeColumns(undefined)).toEqual([]);
    expect(normalizeColumns([])).toEqual([]);
  });
});

describe("queryHash stability", () => {
  const base = {
    datasetId: "ds_1",
    snapshotId: "snap_9",
  };

  it("same logical query → same hash", async () => {
    const h1 = await queryHash({
      ...base,
      columns: ["b", "a"],
      filter: "b = 2 AND a = 1",
    });
    const h2 = await queryHash({
      ...base,
      columns: ["a", "b"],
      filter: "a = 1 AND b = 2",
    });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different columns → different hash", async () => {
    const h1 = await queryHash({ ...base, columns: ["a"] });
    const h2 = await queryHash({ ...base, columns: ["b"] });
    expect(h1).not.toBe(h2);
  });

  it("different filter → different hash", async () => {
    const h1 = await queryHash({ ...base, filter: "a = 1" });
    const h2 = await queryHash({ ...base, filter: "a = 2" });
    expect(h1).not.toBe(h2);
  });

  it("different snapshot → different hash", async () => {
    const h1 = await queryHash({ ...base, snapshotId: "s1" });
    const h2 = await queryHash({ ...base, snapshotId: "s2" });
    expect(h1).not.toBe(h2);
  });

  it("different dataset → different hash", async () => {
    const h1 = await queryHash({ datasetId: "d1", snapshotId: "s" });
    const h2 = await queryHash({ datasetId: "d2", snapshotId: "s" });
    expect(h1).not.toBe(h2);
  });

  it("limit affects hash", async () => {
    const h1 = await queryHash({ ...base, limit: 10 });
    const h2 = await queryHash({ ...base, limit: 20 });
    expect(h1).not.toBe(h2);
  });

  it("hashQueryRequest matches queryHash", async () => {
    const req = { datasetId: "ds_1", columns: ["a"], filter: "a > 0", limit: 5 };
    const h1 = await hashQueryRequest(req, "snap_x");
    const h2 = await queryHash({
      datasetId: "ds_1",
      snapshotId: "snap_x",
      columns: ["a"],
      filter: "a > 0",
      limit: 5,
    });
    expect(h1).toBe(h2);
  });

  it("canonical string is deterministic", () => {
    expect(
      canonicalQueryString({
        datasetId: "d",
        snapshotId: "s",
        columns: ["b", "a"],
        filter: "x = 1",
      }),
    ).toBe("d|s|main|a,b|x = 1|");
  });
});

describe("queryHash property: randomized permutations", () => {
  it("column permutations share hash", async () => {
    const cols = ["alpha", "beta", "gamma", "delta"];
    const hashes = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const shuffled = [...cols].sort(() => Math.random() - 0.5);
      hashes.add(
        await queryHash({
          datasetId: "ds",
          snapshotId: "snap",
          columns: shuffled,
          filter: "alpha > 0 AND beta < 10",
        }),
      );
    }
    expect(hashes.size).toBe(1);
  });

  it("AND clause permutations share hash", async () => {
    const clauses = ["a = 1", "b = 2", "c = 3"];
    const hashes = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const shuffled = [...clauses].sort(() => Math.random() - 0.5);
      hashes.add(
        await queryHash({
          datasetId: "ds",
          snapshotId: "snap",
          filter: shuffled.join(" AND "),
        }),
      );
    }
    expect(hashes.size).toBe(1);
  });
});

describe("validateFilter", () => {
  it("allows normal predicates", () => {
    expect(() => validateFilter("pickup_date = '2024-01-01' AND fare > 10")).not.toThrow();
  });

  it("rejects injection attempts", () => {
    expect(() => validateFilter("1=1; DROP TABLE users")).toThrow(FilterValidationError);
    expect(() => validateFilter("a = 1 -- comment")).toThrow(FilterValidationError);
    expect(() => validateFilter("a = 1 UNION SELECT * FROM secrets")).toThrow(
      FilterValidationError,
    );
  });

  it("rejects oversized filters", () => {
    expect(() => validateFilter("a".repeat(5000))).toThrow(FilterValidationError);
  });

  it("allows empty/undefined", () => {
    expect(() => validateFilter(undefined)).not.toThrow();
    expect(() => validateFilter("")).not.toThrow();
  });
});
