"use client";

import dynamic from "next/dynamic";
import { isClerkClientEnabled } from "@/lib/clerk";

const AuthControlsClerk = dynamic(
  () => import("@/components/auth-controls-clerk").then((m) => m.AuthControlsClerk),
  { ssr: false, loading: () => null },
);

/** Top-right account — only mounts Clerk UI when a publishable key is configured. */
export function AuthControls() {
  if (!isClerkClientEnabled()) return null;
  return <AuthControlsClerk />;
}
