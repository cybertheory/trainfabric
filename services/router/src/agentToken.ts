/** Short-lived Trainfabric agent JWTs for Hermes/tf CLI (user-scoped, read-only). */

import { SignJWT, jwtVerify } from "jose";
import type { Identity } from "./resolver";

export const AGENT_TOKEN_ISS = "trainfabric-agent";
export const AGENT_READ_SCOPE = "datasets:read";
const DEFAULT_TTL_SEC = 15 * 60;

export interface AgentTokenClaims {
  subject: string;
  email?: string;
  datasetId?: string;
  scope: string[];
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function mintAgentToken(
  identity: Identity,
  opts: {
    secret: string;
    datasetId?: string;
    ttlSec?: number;
    scope?: string[];
  },
): Promise<string> {
  const scope = opts.scope ?? [AGENT_READ_SCOPE];
  const ttl = opts.ttlSec ?? DEFAULT_TTL_SEC;
  let jwt = new SignJWT({
    email: identity.email,
    dataset_id: opts.datasetId,
    scope,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.subject)
    .setIssuer(AGENT_TOKEN_ISS)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`);
  return jwt.sign(secretKey(opts.secret));
}

export async function verifyAgentToken(
  authHeader: string | null | undefined,
  secret: string | undefined,
): Promise<(Identity & { datasetId?: string; scope: string[] }) | null> {
  if (!secret || !authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      issuer: AGENT_TOKEN_ISS,
      algorithms: ["HS256"],
    });
    if (!payload.sub) return null;
    const scopeRaw = payload.scope;
    const scope = Array.isArray(scopeRaw)
      ? scopeRaw.map(String)
      : typeof scopeRaw === "string"
        ? [scopeRaw]
        : [];
    return {
      subject: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      datasetId: typeof payload.dataset_id === "string" ? payload.dataset_id : undefined,
      scope,
    };
  } catch {
    return null;
  }
}

export function agentHasReadScope(scope: string[] | undefined): boolean {
  return Boolean(scope?.includes(AGENT_READ_SCOPE));
}
