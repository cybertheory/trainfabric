"use client";

import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page";
import type { ReactNode } from "react";
import type { TableOfContents } from "fumadocs-core/server";

export function FumaDocPage({
  title,
  description,
  toc,
  children,
}: {
  title: string;
  description?: string;
  toc: TableOfContents;
  children: ReactNode;
}) {
  return (
    <DocsPage toc={toc}>
      <DocsTitle>{title}</DocsTitle>
      {description ? <DocsDescription>{description}</DocsDescription> : null}
      <DocsBody>{children}</DocsBody>
    </DocsPage>
  );
}
