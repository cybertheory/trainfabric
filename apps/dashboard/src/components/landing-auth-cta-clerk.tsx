"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { LayoutDashboard } from "lucide-react";

/** Single landing-page auth slot: Sign in when out, Dashboard when in. */
export function LandingAuthCtaClerk() {
  return (
    <>
      <SignedOut>
        <Link
          href="/sign-in"
          className="landing-btn-primary ml-1 inline-flex min-h-8 shrink-0 items-center rounded-full px-3.5 py-1.5 text-sm font-medium leading-normal text-white sm:min-h-9 sm:px-4"
        >
          Sign in
        </Link>
      </SignedOut>
      <SignedIn>
        <Link
          href="/home"
          className="landing-btn-primary ml-1 inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium leading-normal text-white sm:min-h-9 sm:px-4"
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <div className="ml-1 hidden sm:block">
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: "h-8 w-8",
              },
            }}
          />
        </div>
      </SignedIn>
    </>
  );
}
