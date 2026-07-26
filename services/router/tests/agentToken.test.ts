import { describe, expect, it } from "vitest";
import { mintAgentToken, verifyAgentToken, AGENT_READ_SCOPE } from "../src/agentToken";

describe("agentToken", () => {
  const secret = "test-agent-secret-for-unit-tests-only";

  it("mints and verifies a read-scoped agent token", async () => {
    const token = await mintAgentToken(
      { subject: "user_123", email: "a@b.co" },
      { secret, datasetId: "ds_abc" },
    );
    const id = await verifyAgentToken(`Bearer ${token}`, secret);
    expect(id?.subject).toBe("user_123");
    expect(id?.email).toBe("a@b.co");
    expect(id?.datasetId).toBe("ds_abc");
    expect(id?.scope).toContain(AGENT_READ_SCOPE);
  });

  it("rejects wrong secret", async () => {
    const token = await mintAgentToken({ subject: "user_123" }, { secret });
    const id = await verifyAgentToken(`Bearer ${token}`, "other-secret");
    expect(id).toBeNull();
  });
});
