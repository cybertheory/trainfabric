"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { isClerkClientEnabled } from "@/lib/clerk";

type Preview = {
  user_code: string;
  status: string;
  client_name: string | null;
  expires_at: number;
  expired: boolean;
};

export default function DeviceLoginPage() {
  if (!isClerkClientEnabled()) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Device login</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Clerk is not configured in this environment, so device approval is unavailable.
        </p>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
      <DeviceLoginInner />
    </Suspense>
  );
}

function DeviceLoginInner() {
  const { getToken, isSignedIn } = useAuth();
  const search = useSearchParams();
  const initial = (search.get("user_code") || "").toUpperCase();
  const [code, setCode] = useState(initial);
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setToken(null);
      return;
    }
    void getToken().then((v) => setToken(v ?? null));
  }, [getToken, isSignedIn]);

  const normalized = useMemo(
    () => code.trim().toUpperCase().replace(/\s+/g, ""),
    [code],
  );

  useEffect(() => {
    if (!token || normalized.length < 8) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void apiFetch<Preview>(`/auth/device/preview?user_code=${encodeURIComponent(normalized)}`, {
      token,
    })
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, normalized]);

  async function approve() {
    if (!token) return;
    setBusy(true);
    try {
      await apiFetch("/auth/device/approve", {
        method: "POST",
        token,
        body: JSON.stringify({ user_code: normalized }),
      });
      setDone("approved");
      toast.success("Device authorized — return to your CLI or MCP client");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  async function deny() {
    if (!token) return;
    setBusy(true);
    try {
      await apiFetch("/auth/device/deny", {
        method: "POST",
        token,
        body: JSON.stringify({ user_code: normalized }),
      });
      setDone("denied");
      toast.message("Device login denied");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deny failed");
    } finally {
      setBusy(false);
    }
  }

  if (done === "approved") {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-20 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        <h1 className="text-2xl font-semibold tracking-tight">Device connected</h1>
        <p className="text-sm text-muted-foreground">
          An API key was issued to your CLI or MCP client. You can close this tab.
        </p>
      </div>
    );
  }

  if (done === "denied") {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-20 text-center">
        <XCircle className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Request denied</h1>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/5">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Authorize device</h1>
          <p className="text-sm text-muted-foreground">
            Confirm a <code className="text-xs">tf login</code> or MCP device code for your account.
          </p>
        </div>
      </div>

      <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
        User code
      </label>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABCD-EFGH"
        className="mt-2 w-full rounded-md border border-[hsl(var(--border-subtle))] bg-transparent px-3 py-3 font-mono text-lg tracking-[0.2em] outline-none focus:border-foreground/40"
        autoComplete="one-time-code"
        spellCheck={false}
      />

      {preview ? (
        <div className="mt-4 rounded-md border border-[hsl(var(--border-subtle))] px-3 py-3 text-sm">
          <p>
            Client: <span className="font-medium">{preview.client_name || "unknown"}</span>
          </p>
          <p className="text-muted-foreground">
            Status: {preview.expired ? "expired" : preview.status}
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex gap-2">
        <Button
          onClick={() => void approve()}
          disabled={busy || !token || normalized.length < 8 || preview?.expired || preview?.status !== "pending"}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Approve
        </Button>
        <Button
          variant="outline"
          onClick={() => void deny()}
          disabled={busy || !token || normalized.length < 8}
        >
          Deny
        </Button>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Approving creates a long-lived API key for this device. Manage keys under{" "}
        <a href="/settings/keys" className="underline underline-offset-2">
          Settings → API keys
        </a>
        .
      </p>
    </div>
  );
}
