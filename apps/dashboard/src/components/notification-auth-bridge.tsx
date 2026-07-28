"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { isClerkClientEnabled } from "@/lib/clerk";
import { useJobTracker } from "@/lib/job-tracker";

const Bridge = dynamic(
  () => import("./notification-auth-bridge-inner").then((m) => m.NotificationAuthBridgeInner),
  { ssr: false },
);

function MarkAuthReadyWithoutClerk() {
  const { setAuthReady } = useJobTracker();
  useEffect(() => {
    setAuthReady(true);
  }, [setAuthReady]);
  return null;
}

/** Syncs Clerk JWT into JobTracker so social notifications can be polled. */
export function NotificationAuthBridge() {
  if (!isClerkClientEnabled()) return <MarkAuthReadyWithoutClerk />;
  return <Bridge />;
}

export { markServerNotificationRead, markAllServerNotificationsRead } from "./notification-auth-bridge-inner";
