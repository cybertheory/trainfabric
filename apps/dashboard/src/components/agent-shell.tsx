"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, BookOpen, FolderGit2, Plus, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

const AGENT_PREFIXES = ["/agents", "/auto"];

export function AgentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAgentRoute = AGENT_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!isAgentRoute) {
    return (
      <main className="tf-canvas mx-auto min-h-[calc(100vh-3.5rem)] max-w-7xl px-4 py-8">
        {children}
      </main>
    );
  }

  return (
    <div className="tf-canvas flex min-h-[calc(100vh-3.5rem)]">
      <aside className="tf-surface sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 flex-col gap-6 overflow-y-auto border-r border-[hsl(var(--border-subtle))] p-4 lg:flex">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Agents
          </p>
          <nav className="space-y-0.5 text-sm">
            <RailLink href="/agents" icon={Radio} active={pathname === "/agents"}>
              All runs
            </RailLink>
            <RailLink
              href="/agents/new"
              icon={Plus}
              active={pathname === "/agents/new"}
            >
              New agent
            </RailLink>
          </nav>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Resources
          </p>
          <nav className="space-y-0.5 text-sm">
            <RailLink href="/docs/mcp" icon={BookOpen} active={pathname.startsWith("/docs/mcp")}>
              MCP
            </RailLink>
            <RailLink href="/datasets" icon={FolderGit2} active={pathname.startsWith("/datasets")}>
              Datasets
            </RailLink>
            <RailLink href="/docs/agents" icon={Bot} active={pathname.startsWith("/docs/agents")}>
              Docs
            </RailLink>
          </nav>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

function RailLink({
  href,
  icon: Icon,
  active,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors",
        active
          ? "bg-[hsl(var(--elevated))] text-foreground"
          : "text-muted-foreground hover:bg-[hsl(var(--elevated))]/60 hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {children}
    </Link>
  );
}
