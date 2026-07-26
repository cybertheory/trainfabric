import Link from "next/link";
import { clerkPublishableKey } from "@/lib/clerk";
import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  const pk = clerkPublishableKey();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[hsl(195_35%_96%)] px-4 py-12">
      <Link
        href="/"
        className="mb-8 font-semibold tracking-tight text-[hsl(210_35%_10%)] hover:opacity-80"
      >
        Trainfabric
      </Link>
      {pk ? (
        <SignInForm />
      ) : (
        <div className="max-w-sm rounded-lg border bg-white p-6 text-center text-sm shadow-sm">
          <p className="font-medium text-foreground">Clerk is not configured</p>
          <p className="mt-2 text-muted-foreground">
            Set <code className="text-[11px]">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and{" "}
            <code className="text-[11px]">CLERK_SECRET_KEY</code> to enable sign-in.
          </p>
          <Link href="/home" className="mt-4 inline-block text-primary underline underline-offset-2">
            Continue to dashboard (open mode)
          </Link>
        </div>
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Sign in to use the dashboard, agents, and datasets.
      </p>
    </div>
  );
}
