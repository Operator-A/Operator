// check:wording (card 187, docs/setup.md): a founder never reads an env var name for the Controls switch.
// Screens and action replies say "real runs are switched off on this OPERATOR"; DASHBOARD_CONTROLS stays in
// comments, docs and dashboard/session.ts, which reads it.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
const files = ["app", "dashboard", "ee"].flatMap(walk).filter((f) => f !== join("dashboard", "session.ts") && !f.endsWith("check.ts"));
const bad: string[] = [];
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").trim();
    if (code.startsWith("*") || code.startsWith("/*")) return;
    if (/DASHBOARD_CONTROLS/.test(code)) bad.push(`${f}:${i + 1}: ${code.slice(0, 120)}`);
  });
}
assert.deepEqual(bad, [], "a screen or reply names DASHBOARD_CONTROLS; say \"real runs are switched off on this OPERATOR\" instead");
console.log("check:wording ok");
