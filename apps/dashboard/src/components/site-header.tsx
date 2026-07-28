"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bot, BookOpen, Database, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthControls } from "@/components/auth-controls";
import { AlertBellButton, JobProgressChip } from "@/components/alert-drawer";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");

  function navClass(href: string) {
    const active = pathname === href || (href !== "/home" && pathname.startsWith(href));
    return cn(
      "rounded-md px-2 py-1 transition-colors hover:text-foreground",
      active ? "bg-[hsl(var(--elevated))] text-foreground" : "text-muted-foreground",
    );
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/datasets?search=${encodeURIComponent(term)}` : "/datasets");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4">
        <Link href="/home" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <Database className="h-5 w-5 text-primary" />
          <span className="font-display">Trainfabric</span>
        </Link>

        <nav className="hidden items-center gap-0.5 text-sm md:flex">
          <Link href="/home" className={navClass("/home")}>
            Home
          </Link>
          <Link href="/agents" className={navClass("/agents")}>
            Agents
          </Link>
          <Link href="/datasets" className={navClass("/datasets")}>
            Discover
          </Link>
        </nav>

        <form
          onSubmit={onSearch}
          className="tf-inset ml-2 hidden h-9 max-w-sm flex-1 items-center gap-2 px-3 sm:flex"
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search datasets…"
            className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search datasets"
          />
        </form>

        <div className="ml-auto flex items-center gap-2">
          <JobProgressChip />
          <AlertBellButton />
          <ThemeToggle />
          <Button asChild size="sm" variant="ghost">
            <Link href="/docs" aria-label="Documentation">
              <BookOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Docs</span>
            </Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/agents/new">
              <Bot className="h-4 w-4" />
              Start agent
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="hidden md:inline-flex">
            <Link href="/new">
              <Plus className="h-4 w-4" />
              Publish
            </Link>
          </Button>
          <AuthControls />
        </div>
      </div>
    </header>
  );
}
