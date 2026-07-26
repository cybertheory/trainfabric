import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { isClerkServerEnabled } from "@/lib/clerk";

/**
 * Dashboard shell — requires Clerk sign-in when keys are configured.
 * Marketing (`/`) and docs stay public.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (isClerkServerEnabled()) {
    const { auth } = await import("@clerk/nextjs/server");
    // Redirects to NEXT_PUBLIC_CLERK_SIGN_IN_URL (/sign-in) when signed out.
    await auth.protect();
  }

  return (
    <>
      <SiteHeader />
      {!isClerkServerEnabled() ? (
        <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-center text-xs text-amber-900 dark:text-amber-100">
          Clerk is not configured — dashboard auth is open. Set{" "}
          <code className="text-[11px]">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and{" "}
          <code className="text-[11px]">CLERK_SECRET_KEY</code> to require sign-in.{" "}
          <Link href="/sign-in" className="underline underline-offset-2">
            Sign-in page
          </Link>
        </div>
      ) : null}
      <main className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-7xl px-4 py-8">{children}</main>
    </>
  );
}
