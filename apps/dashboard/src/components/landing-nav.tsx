"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-[hsl(195_18%_84%/0.8)] bg-[hsl(195_28%_96%/0.85)] backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link
          href="/"
          className="font-display text-lg font-bold tracking-tight text-[hsl(210_35%_10%)]"
        >
          Trainfabric
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/datasets"
            className="rounded-md px-3 py-1.5 text-sm text-[hsl(210_14%_32%)] transition hover:text-[hsl(210_28%_12%)]"
          >
            Datasets
          </Link>
          <Link
            href="/new"
            className="inline-flex h-9 items-center rounded-md bg-[hsl(168_55%_28%)] px-3.5 text-sm font-medium text-white transition hover:bg-[hsl(168_55%_24%)]"
          >
            Publish
          </Link>
        </nav>
      </div>
    </header>
  );
}
