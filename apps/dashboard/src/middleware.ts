import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

/**
 * When Clerk keys are set, run clerkMiddleware so session cookies work and
 * `auth.protect()` in the dashboard `(app)` layout can require sign-in.
 * Without keys this is a no-op so `next build` still works.
 *
 * Public: `/`, `/docs`, `/sign-in`, `/sign-up`.
 * Protected: everything under `(app)` via layout `auth.protect()`.
 */
export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const sk = process.env.CLERK_SECRET_KEY?.trim();
  const enabled = Boolean(pk?.startsWith("pk_") && sk?.startsWith("sk_"));

  if (!enabled) {
    return NextResponse.next();
  }

  const { clerkMiddleware } = await import("@clerk/nextjs/server");
  return clerkMiddleware()(req, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
