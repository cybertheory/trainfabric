"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Link2Off, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = {
  datasetId: string;
  token?: string | null;
  className?: string;
  size?: "sm" | "default" | "lg" | "icon";
};

export function ConnectButton({ datasetId, token, className, size = "sm" }: Props) {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    apiFetch<{ connected: boolean }>(`/datasets/${datasetId}/connect`, { token })
      .then((r) => setConnected(!!r.connected))
      .catch(() => setConnected(false))
      .finally(() => setLoading(false));
  }, [datasetId, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggle() {
    setBusy(true);
    try {
      const out = await apiFetch<{ connected: boolean }>(`/datasets/${datasetId}/connect`, {
        method: "POST",
        token,
        body: JSON.stringify({}),
      });
      setConnected(!!out.connected);
      toast.success(out.connected ? "Connected" : "Disconnected", {
        description: out.connected
          ? "You’ll see updates from this dataset community in your feed."
          : "Removed from your connections.",
      });
    } catch (e) {
      toast.error("Could not update connection", { description: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant={connected ? "default" : "outline"}
      size={size}
      className={cn(className)}
      disabled={loading || busy}
      onClick={toggle}
      aria-pressed={connected}
      title={connected ? "Disconnect from dataset" : "Connect to dataset"}
    >
      {loading || busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : connected ? (
        <Link2 className="h-4 w-4" />
      ) : (
        <Link2Off className="h-4 w-4" />
      )}
      {connected ? "Connected" : "Connect"}
    </Button>
  );
}
