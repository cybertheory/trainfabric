"use client";

import dynamic from "next/dynamic";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { JobTrackerProvider } from "@/lib/job-tracker";
import { AlertDrawer } from "@/components/alert-drawer";
import { clerkPublishableKey } from "@/lib/clerk";

const ClerkRoot = dynamic(
  () => import("@/components/clerk-root").then((m) => m.ClerkRoot),
  { ssr: false },
);

function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <JobTrackerProvider>
          {children}
          <AlertDrawer />
          <Toaster />
        </JobTrackerProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const pk = clerkPublishableKey();
  const tree = <AppProviders>{children}</AppProviders>;
  if (!pk) return tree;
  return <ClerkRoot publishableKey={pk}>{tree}</ClerkRoot>;
}
