"use client";

import { useAuth } from "@clerk/nextjs";
import { PublishForm } from "@/app/(app)/new/publish-form";

/** Loaded only when Clerk publishable key is configured. */
export default function PublishWithClerk() {
  const { getToken } = useAuth();
  return <PublishForm getToken={async () => (await getToken()) ?? null} />;
}
