"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useJobTracker } from "@/lib/job-tracker";
import { publicApiOrigin } from "@/lib/api";

export function NotificationAuthBridgeInner() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { setAuthToken, setAuthReady } = useJobTracker();

  useEffect(() => {
    // Don't clear the token while Clerk is still hydrating — that races pages
    // into unauthenticated fetches that 401 and can overwrite a later success.
    if (!isLoaded) return;

    if (!isSignedIn) {
      setAuthToken(null);
      setAuthReady(true);
      return;
    }

    let cancelled = false;
    void getToken().then((t) => {
      if (cancelled) return;
      setAuthToken(t ?? null);
      setAuthReady(true);
    });
    const iv = window.setInterval(() => {
      void getToken().then((t) => {
        if (cancelled) return;
        setAuthToken(t ?? null);
      });
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [getToken, isSignedIn, isLoaded, setAuthToken, setAuthReady]);

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
