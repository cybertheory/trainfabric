#!/usr/bin/env node
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
const OUT = "/tmp/tf-wait-quiet.log";
writeFileSync(OUT, "");
const say = (s) => {
  appendFileSync(OUT, s + "\n");
  console.log(s);
};
for (let i = 0; i < 16; i++) {
  await new Promise((r) => setTimeout(r, 45_000));
  const r = existsSync("/tmp/tf-box-resume-smoke.log")
    ? readFileSync("/tmp/tf-box-resume-smoke.log", "utf8")
    : "";
  const w = existsSync("/tmp/tf-box-watch-fork.log")
    ? readFileSync("/tmp/tf-box-watch-fork.log", "utf8")
    : "";
  const rl = r.trim().split("\n").slice(-2).join(" | ");
  const wl = w.trim().split("\n").slice(-2).join(" | ");
  say(`t=${(i + 1) * 45}s resume=[${rl}] fork=[${wl}]`);
  if (r.includes("DONE_RESUME_OK") || w.includes("DONE_OK") || r.includes("READY") || w.includes("READY")) {
    say("SUCCESS");
    process.exit(0);
  }
  if (r.includes("RESUME_TIMEOUT") || w.includes("TIMEOUT") || r.includes("BAD") || w.includes("BAD_STATE")) {
    say("FAIL");
    process.exit(1);
  }
}
say("GIVE_UP");
process.exit(2);
