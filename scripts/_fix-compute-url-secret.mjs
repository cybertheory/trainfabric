#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const router = join(dirname(fileURLToPath(import.meta.url)), "..", "services/router");
const list = spawnSync("npx", ["wrangler", "secret", "list"], {
  cwd: router,
  encoding: "utf8",
});
const names = JSON.parse(list.stdout || "[]").map((x) => x.name);
console.log("secrets", names.filter((n) => /COMPUTE|MODAL|R2_/.test(n)));
if (names.includes("COMPUTE_URL")) {
  console.log("deleting COMPUTE_URL so production uses Containers…");
  const del = spawnSync("npx", ["wrangler", "secret", "delete", "COMPUTE_URL", "--force"], {
    cwd: router,
    encoding: "utf8",
  });
  console.log(del.stdout || del.stderr);
} else {
  console.log("no COMPUTE_URL secret — Worker may still bind COMPUTE_URL from vars; check wrangler.toml [vars]");
}
