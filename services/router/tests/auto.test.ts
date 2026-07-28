import { describe, expect, it } from "vitest";
import type { AutoProtocol, AutoRun, AutoTrial } from "@trainfabric/shared";
import { completeTrial, reconcileAutoRunLiveness } from "../src/auto";
import type { AutoStore } from "../src/autoStore";
import { BoxError, type BoxClient } from "../src/box";

function memoryStore(seed?: { run?: AutoRun; trial?: AutoTrial }): AutoStore {
  const runs = new Map<string, AutoRun>();
  const trials = new Map<string, AutoTrial>();
  const activity: import("@trainfabric/shared").AutoActivity[] = [];
  const messages: import("@trainfabric/shared").AutoMessage[] = [];
  if (seed?.run) runs.set(seed.run.id, seed.run);
  if (seed?.trial) trials.set(seed.trial.id, seed.trial);
  return {
    async upsertAutoRun(body) {
      const cur = runs.get(body.id);
      runs.set(body.id, { ...(cur as AutoRun), ...body, updatedAt: Date.now() } as AutoRun);
    },
    async getAutoRun(id) {
      return runs.get(id) ?? null;
    },
    async listAutoRuns(datasetId, ownerId) {
      return [...runs.values()].filter(
        (r) =>
          (r.datasetId === datasetId || (r.boundDatasets ?? []).includes(datasetId)) &&
          (!ownerId || r.ownerId === ownerId),
      );
    },
    async listAutoRunsByOwner(ownerId) {
      return [...runs.values()].filter((r) => r.ownerId === ownerId);
    },
    async upsertAutoTrial(body) {
      const cur = trials.get(body.id);
      trials.set(body.id, {
        ...(cur as AutoTrial),
        ...body,
        updatedAt: Date.now(),
      } as AutoTrial);
    },
    async getAutoTrial(id) {
      return trials.get(id) ?? null;
    },
    async listAutoTrials(autoRunId) {
      return [...trials.values()].filter((t) => t.autoRunId === autoRunId);
    },
    async claimPendingTrial(ownerId) {
      for (const t of trials.values()) {
        if (t.status !== "pending") continue;
        const run = runs.get(t.autoRunId);
        if (!run || run.ownerId !== ownerId) continue;
        const next = { ...t, status: "claimed" as const, updatedAt: Date.now() };
        trials.set(t.id, next);
        return next;
      }
      return null;
    },
    async upsertAutoRunner(body) {
      return body as never;
    },
    async getAutoRunnerByTokenHash() {
      return null;
    },
    async listAutoRunners() {
      return [];
    },
    async appendActivity(body) {
      const entry = { ...body, createdAt: body.createdAt ?? Date.now() };
      activity.push(entry);
      return entry;
    },
    async listActivity(autoRunId) {
      return activity.filter((a) => a.autoRunId === autoRunId);
    },
    async appendMessage(body) {
      const entry = { ...body, createdAt: body.createdAt ?? Date.now() };
      messages.push(entry);
      return entry;
    },
    async listMessages(autoRunId) {
      return messages.filter((m) => m.autoRunId === autoRunId);
    },
  };
}

describe("completeTrial ratchet", () => {
  it("keeps improving min scores and marks done at budget", async () => {
    const protocol: AutoProtocol = {
      snapshotId: "snap1",
      metric: { name: "val_bpb", direction: "min" },
      budget: { maxTrials: 2, maxWallClockSec: 100 },
      mutablePaths: ["train.py"],
      immutablePaths: ["prepare.py"],
    };
    const run: AutoRun = {
      id: "auto_1",
      datasetId: "ds1",
      ownerId: "u1",
      status: "running",
      repo: { url: "https://github.com/x/y", defaultBranch: "main" },
      protocol,
      box: {},
      compute: { provider: "runner" },
      progress: { trial: 1, bestScore: 1.2, updatedAt: 1 },
      createdAt: 1,
      updatedAt: 1,
    };
    const trial: AutoTrial = {
      id: "trial_1",
      autoRunId: "auto_1",
      status: "running",
      createdAt: 1,
      updatedAt: 1,
    };
    const store = memoryStore({ run, trial });
    const out = await completeTrial({
      store,
      run,
      trial,
      body: { status: "done", score: 1.0, commitSha: "abc" },
    });
    expect(out.trial.kept).toBe(true);
    expect(out.run.progress.bestScore).toBe(1.0);
    expect(out.run.status).toBe("done");
  });
});

function baseRun(overrides: Partial<AutoRun> = {}): AutoRun {
  return {
    id: "auto_live",
    ownerId: "u1",
    status: "running",
    repo: { url: "https://github.com/x/y", defaultBranch: "main" },
    protocol: {
      metric: { name: "mae", direction: "min" },
      budget: { maxTrials: 3, maxWallClockSec: 100 },
      mutablePaths: ["train.py"],
      immutablePaths: [],
    },
    box: { boxId: "bx_dead" },
    compute: { provider: "trainfabric_gpu" },
    progress: { trial: 0, updatedAt: Date.now() },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("reconcileAutoRunLiveness", () => {
  it("marks running runs error when Box is stopped", async () => {
    const run = baseRun();
    const store = memoryStore({ run });
    const box = {
      get: async () => ({ id: "bx_dead", state: "stopped" }),
    } as unknown as BoxClient;
    const next = await reconcileAutoRunLiveness({ store, run, box });
    expect(next.status).toBe("error");
    expect(next.error).toMatch(/stopped/i);
    expect((await store.getAutoRun(run.id))?.status).toBe("error");
  });

  it("marks error when Box is gone (404)", async () => {
    const run = baseRun();
    const store = memoryStore({ run });
    const box = {
      get: async () => {
        throw new BoxError("missing", 404);
      },
    } as unknown as BoxClient;
    const next = await reconcileAutoRunLiveness({ store, run, box });
    expect(next.status).toBe("error");
    expect(next.error).toMatch(/no longer exists/i);
  });

  it("marks error after stale heartbeat without Box client", async () => {
    const now = 1_000_000;
    const run = baseRun({
      progress: { trial: 1, updatedAt: now - 60 * 60 * 1000 },
      updatedAt: now - 60 * 60 * 1000,
    });
    const store = memoryStore({ run });
    const next = await reconcileAutoRunLiveness({
      store,
      run,
      box: null,
      now,
      staleMs: 30 * 60 * 1000,
    });
    expect(next.status).toBe("error");
    expect(next.error).toMatch(/heartbeat/i);
  });

  it("leaves paused runs alone even if Box is stopped", async () => {
    const run = baseRun({ status: "paused" });
    const store = memoryStore({ run });
    const box = {
      get: async () => ({ id: "bx_dead", state: "stopped" }),
    } as unknown as BoxClient;
    const next = await reconcileAutoRunLiveness({ store, run, box });
    expect(next.status).toBe("paused");
  });

  it("leaves fresh running runs alone when Box is idle", async () => {
    const run = baseRun({ progress: { trial: 0, updatedAt: Date.now() } });
    const store = memoryStore({ run });
    const box = {
      get: async () => ({ id: "bx_ok", state: "idle" }),
    } as unknown as BoxClient;
    const next = await reconcileAutoRunLiveness({ store, run, box });
    expect(next.status).toBe("running");
  });
});
