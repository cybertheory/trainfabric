"use client";

import dynamic from "next/dynamic";
import { ConnectButton } from "@/components/connect-button";
import { isClerkClientEnabled } from "@/lib/clerk";

const ConnectWithClerk = dynamic(() => import("./dataset-connect-with-clerk"), {
  ssr: false,
});

export function DatasetConnectButton({ datasetId }: { datasetId: string }) {
  if (!isClerkClientEnabled()) {
    return <ConnectButton datasetId={datasetId} />;
  }
  return <ConnectWithClerk datasetId={datasetId} />;
}
