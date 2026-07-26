"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { isClerkClientEnabled } from "@/lib/clerk";

const LandingAuthCtaClerk = dynamic(
  () => import("./landing-auth-cta-clerk").then((m) => m.LandingAuthCtaClerk),
  {
    ssr: false,
    loading: () => (
      <Link
        href="/sign-in"
        className="landing-btn-primary ml-1 inline-flex min-h-8 shrink-0 items-center rounded-full px-3.5 py-1.5 text-sm font-medium leading-normal text-white sm:min-h-9 sm:px-4"
      >
        Sign in
      </Link>
    ),
  },
);

/**
 * Landing nav auth: one CTA only.
 * Signed out → Sign in. Signed in → Dashboard.
 * Falls back to Sign in when Clerk is not configured.
 */
export function LandingAuthCta() {
  if (!isClerkClientEnabled()) {
    return (
      <Link
        href="/sign-in"
        className="landing-btn-primary ml-1 inline-flex min-h-8 shrink-0 items-center rounded-full px-3.5 py-1.5 text-sm font-medium leading-normal text-white sm:min-h-9 sm:px-4"
      >
        Sign in
      </Link>
    );
  }
  return <LandingAuthCtaClerk />;
}
