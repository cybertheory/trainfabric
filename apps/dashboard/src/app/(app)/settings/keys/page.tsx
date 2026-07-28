"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { isClerkClientEnabled } from "@/lib/clerk";

type TfKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
};

const MCP_URL = "https://trainfabric-router.rishabhspro.workers.dev/mcp";

export default function ApiKeysSettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
      <ApiKeysSettingsInner />
    </Suspense>
  );
}

function ApiKeysSettingsInner() {
  const clerkOn = isClerkClientEnabled();
  const { getToken, isSignedIn } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [keys, setKeys] = useState<TfKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [name, setName] = useState("Dashboard key");

  useEffect(() => {
    if (!clerkOn) {
      setToken(null);
      return;
    }
    if (!isSignedIn) {
      setToken(null);
      return;
    }
    void getToken().then((v) => setToken(v ?? null));
  }, [clerkOn, getToken, isSignedIn]);

  async function refresh(t: string) {
    setLoading(true);
    try {
      const out = await apiFetch<{ keys: TfKey[] }>("/auth/api-keys", { token: t });
      setKeys(out.keys ?? []);
    } catch {
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void refresh(token);
  }, [token]);

  const mcpSnippet = useMemo(() => {
    const secret = freshSecret || "YOUR_API_KEY";
    return JSON.stringify(
      {
        mcpServers: {
          trainfabric: {
            url: MCP_URL,
            headers: {
              Authorization: `Bearer ${secret}`,
            },
          },
        },
      },
      null,
      2,
    );
  }, [freshSecret]);

  async function createKey() {
    if (!token) return;
    setCreating(true);
    try {
      const out = await apiFetch<{
        secret: string;
        token_type: string;
        id: string;
        name: string;
      }>("/auth/api-keys", {
        method: "POST",
        token,
        body: JSON.stringify({ name }),
      });
      setFreshSecret(out.secret);
      toast.success(
        out.token_type === "clerk_api_key"
          ? "Clerk API key created — copy it now"
          : "API key created — copy it now",
      );
      await refresh(token);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/auth/api-keys/${id}`, { method: "DELETE", token });
      toast.message("Key revoked");
      await refresh(token);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revoke failed");
    }
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    toast.success("Copied");
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Provision long-lived keys for the Trainfabric CLI, MCP, and HTTP API. Prefer{" "}
          <code className="text-xs">tf login</code> (device flow) or create a key here. Copy the
          secret once when it is shown — it will not be displayed again.
        </p>
      </div>

      <section className="mb-10 rounded-lg border border-[hsl(var(--border-subtle))] p-4">
        <h2 className="text-sm font-medium">Create key</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-[hsl(var(--border-subtle))] bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
            placeholder="Key name"
          />
          <Button onClick={() => void createKey()} disabled={!token || creating}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Create
          </Button>
        </div>
        {freshSecret ? (
          <div className="mt-4 rounded-md bg-foreground/[0.03] p-3">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
              Copy this secret now — it will not be shown again.
            </p>
            <div className="mt-2 flex items-start gap-2">
              <code className="flex-1 break-all font-mono text-xs">{freshSecret}</code>
              <Button size="sm" variant="outline" onClick={() => copy(freshSecret)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium">Trainfabric keys</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Trainfabric-native keys yet.</p>
        ) : (
          <ul className="divide-y divide-[hsl(var(--border-subtle))] rounded-lg border border-[hsl(var(--border-subtle))]">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{k.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {k.prefix}… · {k.revokedAt ? "revoked" : "active"}
                  </p>
                </div>
                {!k.revokedAt ? (
                  <Button size="sm" variant="ghost" onClick={() => void revoke(k.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10 rounded-lg border border-[hsl(var(--border-subtle))] p-4">
        <div className="mb-2 flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          <h2 className="text-sm font-medium">MCP (Cursor)</h2>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Paste into Cursor MCP settings. Or run <code className="text-[11px]">tf login</code> and
          use the issued key.
        </p>
        <pre className="overflow-x-auto rounded-md bg-foreground/[0.03] p-3 font-mono text-[11px] leading-relaxed">
          {mcpSnippet}
        </pre>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => copy(mcpSnippet)}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy config
        </Button>
      </section>

      <section className="rounded-lg border border-[hsl(var(--border-subtle))] p-4 text-sm">
        <h2 className="font-medium">Device login</h2>
        <p className="mt-2 text-muted-foreground">
          From a terminal: <code className="text-xs">tf login</code> → open the printed URL (or{" "}
          <a className="underline underline-offset-2" href="/device">
            /device
          </a>
          ) → enter the code → Approve.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Clerk: enable User API keys at{" "}
          <a
            className="underline underline-offset-2"
            href="https://dashboard.clerk.com/~/platform/api-keys"
            target="_blank"
            rel="noreferrer"
          >
            dashboard.clerk.com → API keys
          </a>
          . The profile menu also shows Clerk&apos;s API Keys tab when enabled.
        </p>
      </section>
    </div>
  );
}
