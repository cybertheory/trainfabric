import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

/**
 * Clerk is optional. Without pk_/sk_ keys this is a no-op passthrough so
 * `next build` and production work with zero Clerk configuration.
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
  ],
};
