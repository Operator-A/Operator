// Uploaded exports (card 160, docs/exports.md): `npm run check:exports`. Pure: no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXPORT_LIMITS, FRESH_DAYS, READ_ROWS, ageOf, columnNumbers, exportName, freshDays, isDate, numberOf, parseExport, readCsv, staleNote, typeOf, uploadProblem } from "../core/export-rules";
import { TOOLS } from "../core/tools/catalog";
import { TENANT_TABLES } from "../core/tenancy";

// CSV: quotes, "" inside quotes, commas and newlines in a cell, CRLF, a BOM, blank lines skipped
assert.deepEqual(readCsv('﻿a,b\r\n1,"x, y"\r\n2,"say ""hi""\nthere"\n\n'), [["a", "b"], ["1", "x, y"], ["2", 'say "hi"\nthere']]);
assert.match((readCsv('a\n"open') as { problem: string }).problem, /never closes/);
assert.match((readCsv('a\nx"y"') as { problem: string }).problem, /quote in the middle/);

// numbers and dates as exports write them
assert.equal(numberOf("1,234.50"), 1234.5);
assert.equal(numberOf("$12"), 12);
assert.equal(numberOf("-3"), -3);
for (const bad of ["", "12kg", "1,23", "1.2.3", "=1+1"]) assert.equal(numberOf(bad), null, bad);
assert.ok(isDate("2026-11-20") && isDate("11/20/2026") && isDate("2026-11-20 08:30") && !isDate("Nov 20") && !isDate("2026-13-45"));
assert.equal(typeOf(["1", "", "2.5"]), "number");
assert.equal(typeOf(["2026-11-01", "2026-11-08"]), "date");
assert.equal(typeOf(["1", "a"]), "text");
assert.equal(typeOf(["", " "]), "text");

// a good file: typed columns, clean cells, ragged short rows padded
const log = "Date,Batch,Weight (kg),Notes\n2026-11-02,B1,12.5,fine\n2026-11-09,B2,10\n2026-11-16,B3,\"1,000.25\",\"two\u0007words\"\n";
const p = parseExport(log, Buffer.byteLength(log));
assert.ok(!("problem" in p));
assert.deepEqual(p.columns, [{ name: "Date", type: "date" }, { name: "Batch", type: "text" }, { name: "Weight (kg)", type: "number" }, { name: "Notes", type: "text" }]);
assert.deepEqual(p.rows[1], ["2026-11-09", "B2", "10", ""], "a short row is padded");
assert.equal(p.rows[2][3], "two words", "control characters are stripped");

// every limit
const no = (text: string, re: RegExp, bytes = Buffer.byteLength(text)) => { const r = parseExport(text, bytes); assert.ok("problem" in r, text.slice(0, 40)); assert.match(r.problem, re); };
no("a,b\n1,2", /over 1 MB/, EXPORT_LIMITS.bytes + 1);
no("a,b\n", /header row and at least one row/);
no(Array.from({ length: 41 }, (_, i) => `c${i}`).join(",") + "\n" + "1,".repeat(40) + "1", /41 columns; at most 40/);
no("a,,c\n1,2,3", /needs a name/);
no(`${"x".repeat(61)}\n1`, /at most 60 characters/);
no("Weight,weight\n1,2", /Two columns are named/);
no("a\n" + "1\n".repeat(5001), /5001 rows; at most 5000/);
no("a,b\n1,2,3", /more cells than the header/);
no(`a\n${"x".repeat(501)}`, /over 500 characters/);
no("a\n\u0000", /isn't a text CSV/);
assert.ok(!("problem" in parseExport("a\n" + "1\n".repeat(5000), 10_001)), "exactly 5,000 rows is fine");

// names: plain, one line, no links
assert.deepEqual(exportName("  Roast   log "), { name: "Roast log" });
for (const bad of ["", "   ", "x".repeat(61), "https://evil.example", "<script>", "-dash first"]) assert.ok("problem" in exportName(bad), bad);

// fresh-for days: held between 1 and 90, 7 when missing
assert.equal(freshDays(undefined), FRESH_DAYS.start);
assert.equal(freshDays("0"), 1);
assert.equal(freshDays(400), 90);
assert.equal(freshDays("14"), 14);
assert.equal(freshDays("soon"), 7);

// staleness: whole days since the upload, stale only past the fresh-for days
const now = Date.parse("2026-11-20T12:00:00Z");
assert.deepEqual(ageOf("2026-11-13T12:00:00Z", 7, now), { days: 7, stale: false });
assert.deepEqual(ageOf("2026-11-12T11:00:00Z", 7, now), { days: 8, stale: true });
assert.deepEqual(ageOf("2026-11-21T00:00:00Z", 7, now), { days: 0, stale: false }, "a clock ahead never goes negative");
assert.match(staleNote("Roast log", 9), /9 days old\. Ask the owner for a fresh export of Roast log/);

// numbers in code over all rows, number columns only
assert.deepEqual(columnNumbers(p.columns, p.rows), { rows: 3, weight_kg_count: 3, weight_kg_sum: 1022.75, weight_kg_avg: 340.92, weight_kg_min: 10, weight_kg_max: 1000.25 });

// switch-over: uploads stop once the tool is connected
assert.equal(uploadProblem("active"), null);
assert.equal(uploadProblem(null), null);
assert.match(uploadProblem("switched")!, /uploads have stopped/);

// the tool: untrusted, a read, rows capped
const t = TOOLS.export_rows;
assert.ok(t && t.kind === "read" && t.trusted === false, "Uploaded export is a read of untrusted data");
const last = t.params.find((x) => x.name === "last");
assert.ok(last && last.type === "int" && last.max === READ_ROWS.max && READ_ROWS.max <= 200);

// the table and the wiring
assert.ok((TENANT_TABLES as readonly string[]).includes("file_sources"), "file_sources is a tenant table");
const mig = readFileSync("supabase/migrations/20261223090000_file_sources.sql", "utf8");
assert.match(mig, /org_id uuid not null references orgs\(id\)/);
assert.match(mig, /row_count integer not null default 0 check \(row_count between 0 and 5000\)/, "the row limit is in the table too");
assert.match(mig, /bytes integer not null default 0 check \(bytes between 0 and 1000000\)/, "and the size limit");
assert.match(mig, /create policy org_rows on file_sources/);
assert.match(readFileSync("core/connector-requests.ts", "utf8"), /why === "ready" && \(await switchExports\(data\[0\]\.name\)\)/, "a request closed as ready switches the export over");
const acts = readFileSync("dashboard/connectionActions.ts", "utf8");
assert.match(acts, /await switchExports\(service\);/, "adding a server for the tool switches it over too");
assert.match(acts, /export async function exportUpload[\s\S]*?asRole\("owner"\)[\s\S]*?uploadExport\(/, "only the owner uploads");
assert.match(readFileSync("next.config.ts", "utf8"), /bodySizeLimit: "2mb"/, "a 1 MB file fits in a server action");

console.log("check:exports ok");
