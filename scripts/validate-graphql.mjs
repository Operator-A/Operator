// Validates every gql`…` document against Shopify's Admin 2026-07 schema. Reads anywhere; a
// mutation only in core/shopify-actions.ts, the fixed store actions the gateway runs (check:mcp
// checks each is named on the Shopify profile). No subscriptions. Fetch the schema once: npm run schemas
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { buildClientSchema, parse, validate } from "graphql";

const root = new URL("..", import.meta.url).pathname;
const p = join(root, ".schemas", "admin-2026-07.json");
if (!existsSync(p)) { console.error(`Missing ${p}: run npm run schemas`); process.exit(2); }
const j = JSON.parse(readFileSync(p, "utf8"));
const schema = buildClientSchema(j.data ?? j, { assumeValid: true });

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const q = join(d, f); if (statSync(q).isDirectory()) walk(q); else if (/\.(ts|tsx)$/.test(f)) files.push(q); });
for (const d of ["agents", "packs", "integrations", "core"]) walk(join(root, d));

const fragments = new Map();
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/const (\w+) = gql`(\s*fragment[\s\S]*?)`/g)) fragments.set(m[1], m[2]);

const ACTIONS = "core/shopify-actions.ts";
let docs = 0, bad = 0;
for (const f of files) {
  const rel = relative(root, f);
  for (const m of readFileSync(f, "utf8").matchAll(/gql`([\s\S]*?)`/g)) {
    if (/^\s*fragment\b/.test(m[1])) continue;
    docs++;
    try {
      const doc = m[1].replace(/\$\{(\w+)\}/g, (_, n) => { if (!fragments.has(n)) throw new Error(`unknown fragment \${${n}}`); return fragments.get(n); });
      const ast = parse(doc);
      // Store actions live in one file; everywhere else is read-only. No subscriptions anywhere.
      const ops = ast.definitions.filter((d) => d.kind === "OperationDefinition");
      if (ops.length !== 1) throw new Error("one operation per document");
      if (ops[0].operation === "subscription") throw new Error("subscription found; nothing here subscribes to Shopify");
      if (ops[0].operation === "mutation" && rel !== ACTIONS) throw new Error(`mutation found outside ${ACTIONS}; store actions are fixed mutations there, run only by the gateway`);
      const errs = validate(schema, ast);
      if (errs.length) { bad++; console.error(`✗ ${rel}\n  ${errs.map((e) => e.message).join("\n  ")}`); }
    } catch (e) { bad++; console.error(`✗ ${rel}: ${e.message}`); }
  }
}
console.log(`${docs - bad}/${docs} GraphQL documents valid`);
process.exit(bad ? 1 : 0);
