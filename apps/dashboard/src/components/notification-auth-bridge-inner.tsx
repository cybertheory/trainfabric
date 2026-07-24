"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useJobTracker } from "@/lib/job-tracker";
import { publicApiOrigin } from "@/lib/api";

export function NotificationAuthBridgeInner() {
  const { getToken, isSignedIn } = useAuth();
  const { setAuthToken } = useJobTracker();

  useEffect(() => {
    if (!isSignedIn) {
      setAuthToken(null);
      return;
    }
    void getToken().then((t) => setAuthToken(t ?? null));
    const iv = window.setInterval(() => {
      void getToken().then((t) => setAuthToken(t ?? null));
    }, 60_000);
    return () => window.clearInterval(iv);
  }, [getToken, isSignedIn, setAuthToken]);

  return null;
}

export async function markServerNotificationRead(token: string | null, id: string) {
  if (!token || !id.startsWith("nt_")) return;
  try {
    await fetch(`${publicApiOrigin()}/notifications/${id}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* ignore */
  }
}

export async function markAllServerNotificationsRead(token: string | null) {
  if (!token) return;
  try {
    await fetch(`${publicApiOrigin()}/notifications/read-all`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* ignore */
  }
}
