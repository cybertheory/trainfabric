"use client";

import Link from "next/link";
import { Database, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthControls } from "@/components/auth-controls";
import { AlertBellButton, JobProgressChip } from "@/components/alert-drawer";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/home" className="flex items-center gap-2 font-semibold tracking-tight">
          <Database className="h-5 w-5 text-primary" />
          Trainfabric
        </Link>
        <nav className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/home" className="hover:text-foreground">
            Home
          </Link>
          <Link href="/agents" className="hover:text-foreground">
            Agents
          </Link>
          <Link href="/datasets" className="hover:text-foreground">
            Discover
          </Link>
          <Link href="/docs" className="hover:text-foreground">
            Docs
          </Link>
          <Link href="/docs/mcp" className="hidden hover:text-foreground sm:inline">
            MCP
          </Link>
          <Link href="/docs/api" className="hidden hover:text-foreground sm:inline">
            API
          </Link>
          <Link href="/me" className="hover:text-foreground">
            My datasets
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <JobProgressChip />
          <AlertBellButton />
          <ThemeToggle />
          <Button asChild size="sm">
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
