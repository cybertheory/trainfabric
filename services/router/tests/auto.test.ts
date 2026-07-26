import { describe, expect, it } from "vitest";
import type { AutoProtocol, AutoRun, AutoTrial } from "@trainfabric/shared";
import { completeTrial } from "../src/auto";
import type { AutoStore } from "../src/autoStore";

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
    async listAutoRuns() {
      return [...runs.values()];
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
    async claimPendingTrial() {
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
