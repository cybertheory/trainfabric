"use client";

import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider";
import type { ReactNode } from "react";
import type { PageTree } from "fumadocs-core/server";

export function DocsShell({
  tree,
  children,
}: {
  tree: PageTree.Root;
  children: ReactNode;
}) {
  return (
    <RootProvider
      theme={{
        defaultTheme: "system",
        enabled: true,
      }}
    >
      <DocsLayout
        tree={tree}
        nav={{
          title: "Trainfabric",
          url: "/",
        }}
        links={[
          { text: "Datasets", url: "/datasets" },
          { text: "MCP", url: "/docs/mcp" },
          { text: "API", url: "/docs/api" },
          { text: "Agent Skill", url: "/docs/agent-skill" },
        ]}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
