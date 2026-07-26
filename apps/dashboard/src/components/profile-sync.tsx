"use client";

import dynamic from "next/dynamic";
import { isClerkClientEnabled } from "@/lib/clerk";

const Sync = dynamic(
  () => import("./profile-sync-inner").then((m) => m.ProfileSyncInner),
  { ssr: false },
);

/** Mirrors the signed-in Clerk profile into the TrainFabric social identity. */
export function ProfileSync() {
  if (!isClerkClientEnabled()) return null;
  return <Sync />;
}
