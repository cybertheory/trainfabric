"use client";

import { useEffect, useRef } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import type { UpsertProfileRequest } from "@trainfabric/shared";
import { apiFetch } from "@/lib/api";

/**
 * Syncs the signed-in Clerk user's profile (name, handle, avatar, email) into
 * the TrainFabric social profile store so posts and the feed render a real
 * identity instead of a raw Clerk subject id. Runs once per signed-in session.
 */
export function ProfileSyncInner() {
  const { getToken, isSignedIn } = useAuth();
  const { user, isLoaded } = useUser();
  const synced = useRef<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || !isLoaded || !user) return;
    if (synced.current === user.id) return;
    synced.current = user.id;

    const payload: UpsertProfileRequest = {
      displayName:
        user.fullName ??
        user.username ??
        user.primaryEmailAddress?.emailAddress ??
        undefined,
      username: user.username ?? undefined,
      imageUrl: user.imageUrl || undefined,
      email: user.primaryEmailAddress?.emailAddress ?? undefined,
    };

    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        await apiFetch("/profile", {
          method: "POST",
          token,
          body: JSON.stringify(payload),
        });
      } catch {
        // Non-fatal: profile falls back to identity claims server-side.
        synced.current = null;
      }
    })();
  }, [getToken, isSignedIn, isLoaded, user]);

  return null;
}
