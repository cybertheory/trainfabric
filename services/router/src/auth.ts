/** Clerk JWT + API key + agent token resolution for the Worker. */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { verifyAgentToken, agentHasReadScope } from "./agentToken";
import { verifyClerkApiKey } from "./clerkApiKeys";
import { createApiKeyStore } from "./apiKeys";
import type { Identity } from "./resolver";

export type AuthVia = "clerk" | "api_key" | "agent" | null;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3 && !token.startsWith("ak_") && !token.startsWith("tfak_");
}

function getJwks(issuer: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }
  return jwks;
}

/** Extract display/profile claims from a Clerk JWT payload. */
function profileFromPayload(payload: JWTPayload): Pick<Identity, "email" | "name" | "username" | "imageUrl"> {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v : undefined;
  const p = payload as Record<string, unknown>;
  const first = str(p.first_name) ?? str(p.given_name);
  const last = str(p.last_name) ?? str(p.family_name);
  const fullFromParts = [first, last].filter(Boolean).join(" ") || undefined;
  return {
    email: str(p.email),
    name: str(p.name) ?? str(p.full_name) ?? fullFromParts,
    username: str(p.username) ?? str(p.preferred_username) ?? str(p.nickname),
    imageUrl: str(p.image_url) ?? str(p.picture) ?? str(p.avatar_url),
  };
}

export async function verifyClerkJwt(
  authHeader: string | null | undefined,
  env: { CLERK_JWT_ISSUER?: string; CLERK_JWT_AUDIENCE?: string },
): Promise<Identity | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (!env.CLERK_JWT_ISSUER) {
    // Dev fallback: decode without verify when issuer unset
    try {
      const payload = JSON.parse(atob(token.split(".")[1]!)) as JWTPayload;
      if (payload.sub) {
        return { subject: payload.sub, ...profileFromPayload(payload) };
      }
    } catch {
      return null;
    }
    return null;
  }
  try {
    const opts: { issuer: string; audience?: string } = {
      issuer: env.CLERK_JWT_ISSUER,
    };
    if (env.CLERK_JWT_AUDIENCE?.trim()) {
      opts.audience = env.CLERK_JWT_AUDIENCE;
    }
    const { payload } = await jwtVerify(token, getJwks(env.CLERK_JWT_ISSUER), opts);
    if (!payload.sub) return null;
    return {
      subject: payload.sub,
      ...profileFromPayload(payload),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve Bearer identity for API / MCP / CLI.
 * Order: Clerk session JWT → Clerk ak_* → Trainfabric tfak_* → short-lived agent JWT.
 */
export async function resolveBearerIdentity(
  authHeader: string | null | undefined,
  env: {
    CLERK_JWT_ISSUER?: string;
    CLERK_JWT_AUDIENCE?: string;
    CLERK_SECRET_KEY?: string;
    AGENT_TOKEN_SECRET?: string;
    DB?: D1Database;
  },
): Promise<{ identity: Identity | null; authVia: AuthVia }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { identity: null, authVia: null };
  }
  const raw = authHeader.slice(7).trim();
  if (!raw) return { identity: null, authVia: null };

  if (looksLikeJwt(raw)) {
    // Prefer agent JWTs (iss=trainfabric-agent) before Clerk — Clerk's
    // unverified-dev path would otherwise accept any JWT with a sub.
    const agent = await verifyAgentToken(authHeader, env.AGENT_TOKEN_SECRET);
    if (agent && agentHasReadScope(agent.scope)) {
      return {
        identity: { subject: agent.subject, email: agent.email },
        authVia: "agent",
      };
    }
    const clerk = await verifyClerkJwt(authHeader, env);
    if (clerk) return { identity: clerk, authVia: "clerk" };
    return { identity: null, authVia: null };
  }

  if (raw.startsWith("ak_")) {
    const ak = await verifyClerkApiKey(authHeader, env);
    if (ak) {
      return {
        identity: { subject: ak.subject },
        authVia: "api_key",
      };
    }
    return { identity: null, authVia: null };
  }

  if (raw.startsWith("tfak_")) {
    const store = createApiKeyStore(env.DB);
    const tf = store ? await store.verifyTfApiKey(authHeader) : null;
    if (tf) {
      return {
        identity: { subject: tf.subject },
        authVia: "api_key",
      };
    }
    return { identity: null, authVia: null };
  }

  const agent = await verifyAgentToken(authHeader, env.AGENT_TOKEN_SECRET);
  if (agent && agentHasReadScope(agent.scope)) {
    return {
      identity: { subject: agent.subject, email: agent.email },
      authVia: "agent",
    };
  }
  return { identity: null, authVia: null };
}
