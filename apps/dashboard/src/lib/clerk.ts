/** Clerk is optional — app builds and runs with no Clerk env vars. */

export function clerkPublishableKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (!key || key === "undefined" || key === "null") return undefined;
  if (!key.startsWith("pk_")) return undefined;
  return key;
}

export function clerkSecretKey(): string | undefined {
  const key = process.env.CLERK_SECRET_KEY?.trim();
  if (!key || key === "undefined" || key === "null") return undefined;
  if (!key.startsWith("sk_")) return undefined;
  return key;
}

/** Client UI (Sign in / UserButton) — publishable key only. */
export function isClerkClientEnabled(): boolean {
  return Boolean(clerkPublishableKey());
}

/** Middleware / server auth — needs both keys. */
export function isClerkServerEnabled(): boolean {
  return Boolean(clerkPublishableKey() && clerkSecretKey());
}
