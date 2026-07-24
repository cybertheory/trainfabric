"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ConnectButton } from "@/components/connect-button";

export default function DatasetConnectWithClerk({ datasetId }: { datasetId: string }) {
  const { getToken, isSignedIn } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (!isSignedIn) {
      setToken(null);
      return;
    }
    void getToken().then((t) => setToken(t ?? null));
  }, [getToken, isSignedIn]);
  return <ConnectButton datasetId={datasetId} token={token} />;
}
