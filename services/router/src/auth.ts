/** Clerk JWT validation for the Worker. */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Identity } from "./resolver";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

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
