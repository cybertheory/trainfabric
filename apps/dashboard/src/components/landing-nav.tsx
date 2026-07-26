"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LandingAuthCta } from "@/components/landing-auth-cta";

const LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/mcp", label: "MCP" },
  { href: "/docs/api", label: "API" },
  { href: "/docs/agent-skill", label: "Agent Skill" },
  { href: "/home", label: "Home" },
  { href: "/datasets", label: "Discover" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-4">
      <div
        className={`mx-auto flex h-12 max-w-6xl items-center justify-between gap-3 rounded-full px-4 transition-all duration-300 sm:px-5 ${
          scrolled
            ? "border border-[hsl(200_20%_80%/0.55)] bg-[hsl(195_30%_98%/0.78)] shadow-[0_8px_30px_rgb(15_40_50_/0.08)] backdrop-blur-xl"
            : "border border-transparent bg-transparent"
        }`}
      >
        <Link
          href="/"
          className="shrink-0 font-display text-[15px] font-bold tracking-tight text-[hsl(210_35%_10%)]"
        >
          Trainfabric
        </Link>
        <nav className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          <div className="hidden items-center gap-0.5 md:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full px-2.5 py-2 text-sm leading-normal text-[hsl(210_12%_36%)] transition hover:bg-black/[0.04] hover:text-[hsl(210_28%_12%)]"
              >
                {link.label}
              </Link>
            ))}
          </div>
          <Link
            href="/docs"
            className="rounded-full px-2.5 py-1.5 text-sm text-[hsl(210_12%_36%)] transition hover:bg-black/[0.04] hover:text-[hsl(210_28%_12%)] md:hidden"
          >
            Docs
          </Link>
          <LandingAuthCta />
        </nav>
      </div>
    </header>
  );
}
