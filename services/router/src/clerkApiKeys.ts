/** Clerk user/org API keys (ak_*) via Backend API. */

import type { Identity } from "./resolver";

const CLERK_BAPI = "https://api.clerk.com/v1";

export interface ClerkApiKeyRecord {
  id: string;
  subject: string;
  name?: string;
  scopes?: string[];
  revoked?: boolean;
  expired?: boolean;
  secret?: string;
}

function bearerSecret(secretKey: string | undefined): string | null {
  const sk = secretKey?.trim();
  if (!sk?.startsWith("sk_")) return null;
  return sk;
}

export async function verifyClerkApiKey(
  authHeader: string | null | undefined,
  env: { CLERK_SECRET_KEY?: string },
): Promise<(Identity & { apiKeyId: string; scopes: string[] }) | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const secret = authHeader.slice(7).trim();
  if (!secret.startsWith("ak_")) return null;
  const sk = bearerSecret(env.CLERK_SECRET_KEY);
  if (!sk) return null;

  const res = await fetch(`${CLERK_BAPI}/api_keys/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sk}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ secret }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as ClerkApiKeyRecord;
  if (!json?.subject || json.revoked || json.expired) return null;
  return {
    subject: json.subject,
    apiKeyId: json.id,
    scopes: Array.isArray(json.scopes) ? json.scopes.map(String) : [],
  };
}

export async function createClerkApiKey(
  env: { CLERK_SECRET_KEY?: string },
  opts: {
    subject: string;
    name: string;
    description?: string;
    scopes?: string[];
    createdBy?: string;
    secondsUntilExpiration?: number | null;
  },
): Promise<ClerkApiKeyRecord | null> {
  const sk = bearerSecret(env.CLERK_SECRET_KEY);
  if (!sk) return null;

  const res = await fetch(`${CLERK_BAPI}/api_keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sk}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      name: opts.name,
      subject: opts.subject,
      description: opts.description ?? null,
      scopes: opts.scopes ?? ["trainfabric"],
      created_by: opts.createdBy ?? opts.subject,
      seconds_until_expiration: opts.secondsUntilExpiration ?? null,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("clerk api_keys create failed", res.status, errText.slice(0, 400));
    return null;
  }
  return (await res.json()) as ClerkApiKeyRecord;
}
