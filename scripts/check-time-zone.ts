// check:time-zone (card 187, docs/setup.md): each business keeps its own time zone. Calendar days,
// schedule start times and every time on screen use it; nothing outside core/time.ts names a zone.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TZ, localAt, localDate, startOf, validTz, zoneLabel } from "../core/time";
import { afterStep, firingsBetween, nextFirings, type Chain } from "../core/flow-rules";
import { createdBetween } from "../core/shopify-rules";
import { checkSettingsEdit, editOf, NO_SETTINGS, readSettings } from "../core/settings-rules";
import { deskGreeting } from "../dashboard/desk";
import { nextRuns, schedWords } from "../dashboard/schedule";

const LA = "America/Los_Angeles", CT = "America/Chicago", TOKYO = "Asia/Tokyo";

// a zone is an IANA name Intl knows; anything else is refused
assert.equal(validTz(LA), LA);
assert.equal(validTz(" Europe/London "), "Europe/London");
assert.equal(validTz("UTC"), "UTC");
for (const bad of ["", "Mars/Olympus", "America/Chicago; drop", "../etc", 7, null, "x".repeat(70)]) assert.equal(validTz(bad), null, String(bad));
assert.equal(DEFAULT_TZ, CT, "a business that never picked one starts on Central");

// calendar days and midnights follow the zone: 11 PM in Los Angeles is already tomorrow in Chicago
const late = new Date("2026-11-21T07:00:00Z"); // 11 PM Nov 20 in LA, 1 AM Nov 21 in Chicago
assert.equal(localDate(LA, 0, late), "2026-11-20");
assert.equal(localDate(CT, 0, late), "2026-11-21");
assert.equal(startOf("day", LA, late), "2026-11-20T08:00:00.000Z");
assert.equal(startOf("day", CT, late), "2026-11-21T06:00:00.000Z");
assert.equal(startOf("month", TOKYO, new Date("2026-11-30T16:00:00Z")), "2026-11-30T15:00:00.000Z", "Tokyo is in December already");
assert.equal(localAt("2026-07-01", "07:00", LA), Date.parse("2026-07-01T07:00:00-07:00"), "summer time");
assert.equal(localAt("2026-12-01", "07:00", LA), Date.parse("2026-12-01T07:00:00-08:00"));
assert.match(zoneLabel(LA, Date.parse("2026-12-01T12:00:00Z")), /^PST$/);

// a chain that starts at 7:00 starts at 7:00 where the business is
const morning: Chain = { key: "m", name: "Morning", on: true, start: { type: "schedule", days: "daily", time: "07:00" }, steps: [{ agent: "a" }, { agent: "b", notBefore: "09:00" }] };
const now = Date.parse("2026-11-20T12:00:00Z"); // 6 AM Chicago, 4 AM LA
assert.deepEqual(nextFirings(morning, now, 1, CT), [Date.parse("2026-11-20T07:00:00-06:00")]);
assert.deepEqual(nextFirings(morning, now, 1, LA), [Date.parse("2026-11-20T07:00:00-08:00")]);
assert.deepEqual(firingsBetween(morning, Date.parse("2026-11-20T14:30:00Z"), Date.parse("2026-11-20T15:30:00Z"), LA), [Date.parse("2026-11-20T07:00:00-08:00")]);
assert.deepEqual(firingsBetween(morning, Date.parse("2026-11-20T14:30:00Z"), Date.parse("2026-11-20T15:30:00Z"), CT), [], "7 AM Chicago was an hour before");
const wait = afterStep(morning, 0, { status: "ok" }, LA, Date.parse("2026-11-20T15:05:00Z"));
assert.ok(wait.go && wait.at === Date.parse("2026-11-20T09:00:00-08:00"), "the 9:00 wait is 9:00 in the business's zone");
assert.deepEqual(nextRuns({ kind: "weekdays", time: "06:45" }, now, 1, LA), [Date.parse("2026-11-20T06:45:00-08:00")]);
assert.equal(schedWords({ kind: "daily", time: "07:00" }), "Daily 7:00 AM", "a schedule is a wall-clock time; no zone named");

// Shopify days start at the business's midnight
assert.equal(createdBetween("2026-11-15", "2026-11-16", LA), "created_at:>='2026-11-15T00:00:00-08:00' created_at:<'2026-11-16T00:00:00-08:00'");

// the greeting reads the business's clock
assert.equal(deskGreeting(Date.parse("2026-11-20T18:30:00Z"), CT), "Good afternoon");
assert.equal(deskGreeting(Date.parse("2026-11-20T18:30:00Z"), LA), "Good morning");

// the setting: kept when it reads, dropped when it doesn't, and a bad one is refused on Settings
assert.equal(readSettings({ timeZone: LA }).timeZone, LA);
assert.equal(readSettings({ timeZone: "Nowhere/Land" }).timeZone, null);
assert.equal(NO_SETTINGS.timeZone, null);
const e = { ...editOf(NO_SETTINGS) };
assert.ok("problem" in checkSettingsEdit({ ...e, timeZone: "Nowhere/Land" }, []));
const ok = checkSettingsEdit({ ...e, timeZone: TOKYO }, []);
assert.ok("settings" in ok && ok.settings.timeZone === TOKYO);
assert.ok("settings" in checkSettingsEdit({ ...e, timeZone: "" }, []), "empty means the default");

// no screen, action or core file names a zone of its own: only core/time.ts holds DEFAULT_TZ
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
const files = ["app", "dashboard", "core", "ee", "integrations", "agents"].flatMap(walk).filter((f) => f !== join("core", "time.ts"));
const bad: string[] = [];
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").trim();
    if (code.startsWith("*") || code.startsWith("/*")) return;
    if (/America\/Chicago|Central Time|Central time|[ (]CT\b[^_]|\bchicagoDate\b|\bchicagoAt\b/.test(code)) bad.push(`${f}:${i + 1}: ${code.slice(0, 120)}`);
  });
}
assert.deepEqual(bad, [], "use the business's zone (orgTz(), Floor.tz) and zoneLabel(tz), not Chicago");
console.log("check:time-zone ok");
