"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
        className={`mx-auto flex h-12 max-w-6xl items-center justify-between rounded-full px-4 transition-all duration-300 sm:px-5 ${
          scrolled
            ? "border border-[hsl(200_20%_80%/0.55)] bg-[hsl(195_30%_98%/0.78)] shadow-[0_8px_30px_rgb(15_40_50_/0.08)] backdrop-blur-xl"
            : "border border-transparent bg-transparent"
        }`}
      >
        <Link
          href="/"
          className="font-display text-[15px] font-bold tracking-tight text-[hsl(210_35%_10%)]"
        >
          Trainfabric
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/datasets"
            className="rounded-full px-3 py-1.5 text-sm text-[hsl(210_12%_36%)] transition hover:bg-black/[0.04] hover:text-[hsl(210_28%_12%)]"
          >
            Datasets
          </Link>
          <Link
            href="/new"
            className="landing-btn-primary inline-flex h-8 items-center rounded-full px-3.5 text-sm font-medium text-white sm:h-9 sm:px-4"
          >
            Publish
          </Link>
        </nav>
      </div>
    </header>
  );
}
