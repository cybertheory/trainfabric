"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

type Lang = "json" | "bash" | "text" | "url";

type Token = { type: string; value: string };

function tokenizeJson(src: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /("(?:\\.|[^"\\])*")\s*(:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\b(?:true|false|null)\b)|([{}\[\],])|(\s+)|([^\s{}[\],:"]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] != null) {
      tokens.push({ type: m[2] ? "key" : "string", value: m[1] });
      if (m[2]) tokens.push({ type: "punct", value: m[2] });
    } else if (m[3] != null) tokens.push({ type: "number", value: m[3] });
    else if (m[4] != null) tokens.push({ type: "bool", value: m[4] });
    else if (m[5] != null) tokens.push({ type: "punct", value: m[5] });
    else if (m[6] != null) tokens.push({ type: "plain", value: m[6] });
    else if (m[7] != null) tokens.push({ type: "plain", value: m[7] });
  }
  return tokens;
}

function tokenizeBash(src: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /(#[^\n]*)|('(?:\\'|[^'])*')|("(?:\\.|[^"\\])*")|(\\[^\n]*)|(\b(?:curl|wget|http|https)\b)|(-\w[\w-]*)|([{}()\[\]|&;]|\\)|(\s+)|([^\s#'"\\{}()\[\]|&;-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] != null) tokens.push({ type: "comment", value: m[1] });
    else if (m[2] != null || m[3] != null) tokens.push({ type: "string", value: m[2] ?? m[3]! });
    else if (m[4] != null) tokens.push({ type: "punct", value: m[4] });
    else if (m[5] != null) tokens.push({ type: "keyword", value: m[5] });
    else if (m[6] != null) tokens.push({ type: "flag", value: m[6] });
    else if (m[7] != null) tokens.push({ type: "punct", value: m[7] });
    else if (m[8] != null) tokens.push({ type: "plain", value: m[8] });
    else if (m[9] != null) tokens.push({ type: "plain", value: m[9] });
  }
  return tokens;
}

function tokenizeText(src: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /(\b(?:dataset_id|MCP|inspect_schema|estimate_query|query_slice|Steps|Example)\b)|(`[^`]+`)|(\b[a-f0-9-]{8,}\b)|(\s+)|([^\s`]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] != null) tokens.push({ type: "keyword", value: m[1] });
    else if (m[2] != null) tokens.push({ type: "string", value: m[2] });
    else if (m[3] != null) tokens.push({ type: "number", value: m[3] });
    else if (m[4] != null) tokens.push({ type: "plain", value: m[4] });
    else if (m[5] != null) tokens.push({ type: "plain", value: m[5] });
  }
  return tokens;
}

function tokenizeUrl(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /(https?:\/\/)|(\/[\w./-]*)|([\w.-]+)|([^\w./:-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] != null) tokens.push({ type: "keyword", value: m[1] });
    else if (m[2] != null) tokens.push({ type: "string", value: m[2] });
    else if (m[3] != null) tokens.push({ type: "plain", value: m[3] });
    else if (m[4] != null) tokens.push({ type: "punct", value: m[4] });
  }
  return tokens;
}

const TOKEN_CLASS: Record<string, string> = {
  key: "text-[hsl(199_80%_68%)]",
  string: "text-[hsl(145_55%_62%)]",
  number: "text-[hsl(32_90%_68%)]",
  bool: "text-[hsl(280_65%_72%)]",
  keyword: "text-[hsl(199_85%_70%)]",
  flag: "text-[hsl(32_85%_65%)]",
  comment: "text-muted-foreground/70 italic",
  punct: "text-muted-foreground",
  plain: "text-[hsl(210_20%_88%)]",
};

function tokenize(code: string, language: Lang): Token[] {
  if (language === "json") return tokenizeJson(code);
  if (language === "bash") return tokenizeBash(code);
  if (language === "url") return tokenizeUrl(code);
  return tokenizeText(code);
}

export function CodeHighlight({
  code,
  language = "text",
  className,
}: {
  code: string;
  language?: Lang;
  className?: string;
}) {
  const tokens = useMemo(() => tokenize(code, language), [code, language]);
  return (
    <pre
      className={cn(
        "max-h-56 overflow-auto bg-[#0b1218] p-3 font-mono text-[11px] leading-relaxed",
        className,
      )}
    >
      <code>
        {tokens.map((t, i) => (
          <span key={i} className={TOKEN_CLASS[t.type] ?? TOKEN_CLASS.plain}>
            {t.value}
          </span>
        ))}
      </code>
    </pre>
  );
}
