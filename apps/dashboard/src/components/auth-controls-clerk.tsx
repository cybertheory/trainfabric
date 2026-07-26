"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Loaded only when Clerk publishable key is present. */
export function AuthControlsClerk() {
  return (
    <div className="flex items-center gap-2">
      <SignedOut>
        <Button asChild variant="outline" size="sm">
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/sign-up">Sign up</Link>
        </Button>
      </SignedOut>
      <SignedIn>
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: "h-8 w-8",
            },
          }}
        >
          <UserButton.MenuItems>
            <UserButton.Link
              label="Profile"
              labelIcon={<UserRound className="h-4 w-4" />}
              href="/me"
            />
          </UserButton.MenuItems>
        </UserButton>
      </SignedIn>
    </div>
  );
}
