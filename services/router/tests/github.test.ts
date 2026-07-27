import { describe, expect, it } from "vitest";
import {
  REPO_STARTER_FILES,
  authenticatedCloneUrl,
  githubConfigured,
  signInstallState,
  verifyInstallState,
  verifyWebhookSignature,
} from "../src/github";

const env = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_SLUG: "trainfabric",
  GITHUB_APP_CLIENT_ID: "Iv1.test",
  GITHUB_APP_CLIENT_SECRET: "secret",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
  GITHUB_APP_STATE_SECRET: "state-test-secret",
  GITHUB_APP_WEBHOOK_SECRET: "whsec",
};

describe("githubConfigured", () => {
  it("requires core App credentials", () => {
    expect(githubConfigured({})).toBe(false);
    expect(githubConfigured(env)).toBe(true);
    expect(githubConfigured({ ...env, GITHUB_APP_PRIVATE_KEY: "" })).toBe(false);
  });
});

describe("install state", () => {
  it("signs and verifies round-trip", async () => {
    const state = await signInstallState(env, {
      userId: "user_abc",
      returnTo: "/agents/new",
    });
    const verified = await verifyInstallState(env, state);
    expect(verified.userId).toBe("user_abc");
    expect(verified.returnTo).toBe("/agents/new");
    expect(verified.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects tampered state", async () => {
    const state = await signInstallState(env, {
      userId: "user_abc",
      returnTo: "/agents/new",
    });
    await expect(verifyInstallState(env, state + "x")).rejects.toThrow(/Invalid state/);
  });

  it("rejects expired state", async () => {
    const state = await signInstallState(env, {
      userId: "user_abc",
      returnTo: "/me",
      expSec: -10,
    });
    await expect(verifyInstallState(env, state)).rejects.toThrow(/expired/i);
  });
});

describe("webhook HMAC", () => {
  it("accepts valid sha256 signature", async () => {
    const body = JSON.stringify({ action: "deleted", installation: { id: 1 } });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.GITHUB_APP_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const ok = await verifyWebhookSignature(
      env.GITHUB_APP_WEBHOOK_SECRET,
      body,
      `sha256=${hex}`,
    );
    expect(ok).toBe(true);
  });

  it("rejects bad signature", async () => {
    const ok = await verifyWebhookSignature(
      env.GITHUB_APP_WEBHOOK_SECRET,
      "{}",
      "sha256=deadbeef",
    );
    expect(ok).toBe(false);
  });
});

describe("create-repo helpers", () => {
  it("seeds starter files for platform repos", () => {
    expect(REPO_STARTER_FILES["TRAINFABRIC.md"]).toMatch(/Goal/i);
    expect(REPO_STARTER_FILES["protocol.yaml"]).toMatch(/mutablePaths/);
    expect(REPO_STARTER_FILES["AGENTS.md"]).toBeTruthy();
    expect(REPO_STARTER_FILES[".gitignore"]).toBeTruthy();
  });

  it("builds authenticated clone URLs", () => {
    expect(authenticatedCloneUrl("ghs_test", "acme/web")).toBe(
      "https://x-access-token:ghs_test@github.com/acme/web.git",
    );
  });

  it("validates repo name shape used by create endpoint", () => {
    const valid = /^[A-Za-z0-9_.-]+$/;
    expect(valid.test("my-autoresearch")).toBe(true);
    expect(valid.test("bad name")).toBe(false);
    expect(valid.test("../escape")).toBe(false);
  });
});
