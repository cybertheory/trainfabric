"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { isClerkClientEnabled } from "@/lib/clerk";
import { PublishForm } from "@/app/(app)/new/publish-form";

const PublishWithClerk = dynamic(() => import("@/app/(app)/new/publish-with-clerk"), {
  ssr: false,
  loading: () => <PublishForm getToken={async () => null} />,
});

export default function NewDatasetPage() {
  return (
    <Suspense fallback={null}>
      {isClerkClientEnabled() ? (
        <PublishWithClerk />
      ) : (
        <PublishForm getToken={async () => null} />
      )}
    </Suspense>
  );
}
