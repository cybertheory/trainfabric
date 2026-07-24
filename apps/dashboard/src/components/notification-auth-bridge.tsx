"use client";

import dynamic from "next/dynamic";
import { isClerkClientEnabled } from "@/lib/clerk";

const Bridge = dynamic(
  () => import("./notification-auth-bridge-inner").then((m) => m.NotificationAuthBridgeInner),
  { ssr: false },
);

/** Syncs Clerk JWT into JobTracker so social notifications can be polled. */
export function NotificationAuthBridge() {
  if (!isClerkClientEnabled()) return null;
  return <Bridge />;
}

export { markServerNotificationRead, markAllServerNotificationsRead } from "./notification-auth-bridge-inner";
