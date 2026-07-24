import Link from "next/link";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

const TOP_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/mcp", label: "MCP" },
  { href: "/docs/api", label: "API" },
  { href: "/docs/agent-skill", label: "Agent Skill" },
  { href: "/datasets", label: "Datasets" },
];

function walkTree(
  nodes: typeof source.pageTree.children,
): { url: string; name: string }[] {
  const out: { url: string; name: string }[] = [];
  for (const node of nodes) {
    if (node.type === "page") out.push({ url: node.url, name: String(node.name) });
    if (node.type === "folder") out.push(...walkTree(node.children));
  }
  return out;
}

export default function DocsLayout({ children }: { children: ReactNode }) {
  const pages = walkTree(source.pageTree.children);

  return (
    <div className="min-h-screen bg-[#f7fafb] text-[hsl(210_28%_12%)]">
      <header className="sticky top-0 z-40 border-b border-[hsl(200_18%_88%)] bg-[#f7fafb]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="font-display text-[15px] font-bold tracking-tight">
            Trainfabric
          </Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {TOP_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-full px-2.5 py-1.5 text-[hsl(210_12%_40%)] transition hover:bg-black/[0.04] hover:text-[hsl(210_28%_12%)]"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-[hsl(168_40%_36%)]">
            Documentation
          </p>
          <ul className="space-y-1">
            {pages.map((page) => (
              <li key={page.url}>
                <Link
                  href={page.url}
                  className="block rounded-lg px-3 py-2 text-sm text-[hsl(210_14%_34%)] transition hover:bg-[hsl(168_30%_92%)] hover:text-[hsl(210_28%_12%)]"
                >
                  {page.name}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
