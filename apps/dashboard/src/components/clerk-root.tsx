"use client";

import { ClerkProvider } from "@clerk/nextjs";

/** Only imported when a publishable key exists. */
export function ClerkRoot({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/home"
      signUpFallbackRedirectUrl="/home"
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  );
}
