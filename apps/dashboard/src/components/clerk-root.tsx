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
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      {children}
    </ClerkProvider>
  );
}
