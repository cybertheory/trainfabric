import { describe, expect, it } from "vitest";
import { parseSourceUrl, REMOTE_EXTS } from "../src/remoteSource";
import {
  hfConfigured,
  hfDatasetUrl,
  signHfOAuthState,
  verifyHfOAuthState,
} from "../src/huggingface";

describe("parseSourceUrl", () => {
  it("parses GitHub tree URLs", () => {
    const p = parseSourceUrl("https://github.com/acme/private-data/tree/main/data");
    expect(p).toMatchObject({
      kind: "github",
      owner: "acme",
      repo: "private-data",
      ref: "main",
      path: "data",
    });
  });

  it("parses Hugging Face dataset URLs", () => {
    const p = parseSourceUrl(
      "https://huggingface.co/datasets/org/gated-set/tree/main/train",
    );
    expect(p).toMatchObject({
      kind: "hf",
      repoId: "org/gated-set",
      revision: "main",
      path: "train",
    });
  });
});

describe("REMOTE_EXTS", () => {
  it("includes tabular formats", () => {
    expect(REMOTE_EXTS).toContain(".parquet");
    expect(REMOTE_EXTS).toContain(".csv");
    expect(REMOTE_EXTS).toContain(".jsonl");
  });
});

describe("hf OAuth helpers", () => {
  const env = {
    HF_OAUTH_CLIENT_ID: "hf-client",
    HF_OAUTH_CLIENT_SECRET: "hf-secret",
    HF_OAUTH_STATE_SECRET: "hf-state-secret",
    PUBLIC_API_BASE: "https://example.com",
  };

  it("requires client id + secret", () => {
    expect(hfConfigured({})).toBe(false);
    expect(hfConfigured(env)).toBe(true);
  });

  it("signs and verifies state round-trip", async () => {
    const state = await signHfOAuthState(env, {
      userId: "user_clerk_1",
      returnTo: "/new",
    });
    const verified = await verifyHfOAuthState(env, state);
    expect(verified.userId).toBe("user_clerk_1");
    expect(verified.returnTo).toBe("/new");
  });

  it("builds dataset URLs", () => {
    expect(hfDatasetUrl("org/name")).toBe(
      "https://huggingface.co/datasets/org/name/tree/main",
    );
    expect(hfDatasetUrl("org/name", "v1", "data/train.parquet")).toBe(
      "https://huggingface.co/datasets/org/name/tree/v1/data/train.parquet",
    );
  });
});
