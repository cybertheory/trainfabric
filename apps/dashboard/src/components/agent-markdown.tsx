"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight markdown for home-agent replies (no extra deps).
 * Handles fences, inline code/bold, lists, and Trainfabric id / path links.
 */
export function AgentMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = splitBlocks(text.trim());
  return (
    <div className={cn("space-y-2 text-sm leading-relaxed", className)}>
      {blocks.map((block, i) => {
        if (block.type === "code") {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--inset))] px-2.5 py-2 text-[11px] leading-snug text-foreground"
            >
              <code>{block.value}</code>
            </pre>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-4">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {renderInline(block.value)}
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "list"; items: string[] };

function splitBlocks(src: string): Block[] {
  const out: Block[] = [];
  const fence = /```[\w-]*\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(src))) {
    if (m.index > last) pushTextBlocks(out, src.slice(last, m.index));
    out.push({ type: "code", value: m[1].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < src.length) pushTextBlocks(out, src.slice(last));
  return out.length ? out : [{ type: "text", value: src }];
}

function pushTextBlocks(out: Block[], chunk: string) {
  const paras = chunk.split(/\n{2,}/);
  for (const para of paras) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    const listish = lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l));
    if (listish && lines.length > 1) {
      out.push({
        type: "list",
        items: lines.map((l) => l.replace(/^\s*([-*•]|\d+\.)\s+/, "").trim()),
      });
    } else {
      out.push({ type: "text", value: trimmed });
    }
  }
}

const INLINE_RE =
  /(\*\*[^*]+\*\*|`[^`]+`|\/auto\/[a-zA-Z0-9_]+|\/datasets\/[^\s)\]`'"]+|\/agents\/[a-zA-Z0-9_/-]+|ds_[a-zA-Z0-9]+|auto_[a-zA-Z0-9]+|https?:\/\/[^\s)\]`'"]+)/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE_RE.source, "g");
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(<Fragment key={`${m.index}-${m[0]}`}>{tokenNode(m[0])}</Fragment>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function tokenNode(tok: string): ReactNode {
  if (tok.startsWith("**") && tok.endsWith("**")) {
    return <strong className="font-semibold">{tok.slice(2, -2)}</strong>;
  }
  if (tok.startsWith("`") && tok.endsWith("`")) {
    return (
      <code className="rounded bg-[hsl(var(--inset))] px-1 py-0.5 text-[11px]">{tok.slice(1, -1)}</code>
    );
  }
  if (tok.startsWith("/auto/")) {
    return (
      <Link href={tok} className="font-medium text-primary underline-offset-2 hover:underline">
        {tok}
      </Link>
    );
  }
  if (tok.startsWith("/datasets/") || tok.startsWith("/agents/")) {
    return (
      <Link href={tok} className="font-medium text-primary underline-offset-2 hover:underline">
        {tok}
      </Link>
    );
  }
  if (tok.startsWith("auto_")) {
    return (
      <Link
        href={`/auto/${tok}`}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        {tok}
      </Link>
    );
  }
  if (tok.startsWith("ds_")) {
    return (
      <code className="rounded bg-[hsl(var(--inset))] px-1 py-0.5 text-[11px] text-primary">{tok}</code>
    );
  }
  if (tok.startsWith("http")) {
    return (
      <a
        href={tok}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        {tok}
      </a>
    );
  }
  return tok;
}
