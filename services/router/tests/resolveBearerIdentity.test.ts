import { describe, expect, it, vi } from "vitest";
import { resolveBearerIdentity } from "../src/auth";
import { mintAgentToken } from "../src/agentToken";

describe("resolveBearerIdentity", () => {
  it("resolves agent JWT", async () => {
    const secret = "test-agent-secret-for-unit-tests-only";
    const token = await mintAgentToken({ subject: "user_abc", email: "a@b.co" }, { secret });
    const out = await resolveBearerIdentity(`Bearer ${token}`, {
      AGENT_TOKEN_SECRET: secret,
    });
    expect(out.authVia).toBe("agent");
    expect(out.identity?.subject).toBe("user_abc");
  });

  it("returns null for empty auth", async () => {
    const out = await resolveBearerIdentity(null, {});
    expect(out.identity).toBeNull();
    expect(out.authVia).toBeNull();
  });
});
