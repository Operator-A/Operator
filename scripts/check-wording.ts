// check:wording (card 187, docs/setup.md): a founder never reads an env var name for the Controls switch.
// Screens and action replies say "real runs are switched off on this OPERATOR"; DASHBOARD_CONTROLS stays in
// comments, docs and dashboard/session.ts, which reads it.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { controlsFrom } from "../dashboard/session";

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
// the cloud edition has Controls on unless the env says off; self-host stays off until it says on

assert.equal(controlsFrom(undefined, "cloud"), true, "cloud: on by default");
assert.equal(controlsFrom("off", "cloud"), false, "cloud: the env can still switch them off");
assert.equal(controlsFrom(undefined, undefined), false, "self-host: off until DASHBOARD_CONTROLS=on");
assert.equal(controlsFrom("on", undefined), true);
console.log("check:wording ok");
