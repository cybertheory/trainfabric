"use client";

import dynamic from "next/dynamic";
import { isClerkClientEnabled } from "@/lib/clerk";
import { PublishForm } from "@/app/(app)/new/publish-form";

const PublishWithClerk = dynamic(() => import("@/app/(app)/new/publish-with-clerk"), {
  ssr: false,
  loading: () => <PublishForm getToken={async () => null} />,
});

export default function NewDatasetPage() {
  if (isClerkClientEnabled()) return <PublishWithClerk />;
  return <PublishForm getToken={async () => null} />;
}
