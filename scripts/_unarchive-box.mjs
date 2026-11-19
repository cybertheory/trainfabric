#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vars = Object.fromEntries(
  readFileSync(join(root, "services/router/.dev.vars"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const base = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const id = process.argv[2] || "bx_ckhpxtn3";

async function req(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${vars.BOX_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  console.log(method, path, res.status, JSON.stringify(json).slice(0, 600));
  return { res, json };
}

await req("GET", `/boxes/${id}`);
for (const path of [
  `/boxes/${id}/start`,
  `/boxes/${id}/unarchive`,
  `/boxes/${id}/restore`,
]) {
  await req("POST", path, {});
}
await req("PATCH", `/boxes/${id}`, { state: "stopped" });
await req("PATCH", `/boxes/${id}`, { archived: false });
await req("GET", `/boxes/${id}`);
