"use client";

import { useCallback } from "react";
import { apiFetch } from "@/lib/api";

type TokenGetter = (() => Promise<string | null>) | null;

/** Optional Clerk token for authenticated API calls. */
export function useApiFetch(getToken: TokenGetter = null) {
  return useCallback(
    async <T,>(path: string, opts: RequestInit = {}) => {
      const token = getToken ? await getToken() : null;
      return apiFetch<T>(path, { ...opts, token });
    },
    [getToken],
  );
}
