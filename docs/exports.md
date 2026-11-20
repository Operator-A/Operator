# Uploaded exports (card 160)

When a tool the business uses has no connection (no built-in connector, no MCP server), the department
can still use it: the owner uploads a CSV export, and agents read it through **Uploaded export**
(`export_rows`). Uploading also asks for a real connection to that tool (connector requests), so the
most-wanted tools get built in.

## For the owner

1. Export a CSV from the tool, or from the spreadsheet you keep (with a header row).
2. In the Control Room, open **Connections › Find a tool** and scroll to **Upload an export until it’s
   connected**.
3. Type the tool’s name (for example "Roast log"), pick the file, and optionally set **Fresh for** (days,
   1 to 90; 7 when left empty). Tap **Upload**.
4. Give **Uploaded export** to the agents that should read it, on each agent’s builder **Tools** step.
5. Upload again whenever you have a newer export: it replaces the rows. When an export is past its
   fresh-for days, the list shows it as stale and agents ask you for a fresh one in their reports.

When the tool gets a real connection, close its request on the same page with **It’s connected now**
(or **A built-in connector is ready**), or add its server by address. The export switches over: uploads
stop and the tool tells agents to read the connection instead. **Remove** deletes an export’s rows.

## Limits (approved by the owner, 2026-11-20)

CSV only, at most 1 MB, 5,000 rows and 40 columns, a header row with unique names of up to 60
characters, cells of up to 500 characters. Control characters are stripped. The row and size limits are
also checks on the table.

## Rules

- An uploaded file is untrusted data (`trusted: false`): its rows never choose a recipient, URL, product
  or category.
- Every number an agent sees from it is worked out in code over all the rows (`columnNumbers`): count,
  sum, average, min and max of each number column. Column types (number, date, text) are decided in code.
- One row per tool per org in `file_sources` (org_id, row level security, org_rows, in `TENANT_TABLES`),
  holding the latest upload. Migration `20261223090000_file_sources.sql`.
- Upload and remove are owner only and audited (`upload_export`, `remove_export`).

## Files

- `core/export-rules.ts`: CSV reading, limits, column types, numbers, staleness (pure; `check:exports`).
- `core/exports.ts`: the table: list, read, upload, remove, switch over.
- `core/tools/catalog.ts`: the `export_rows` read tool.
- `dashboard/connectionActions.ts`: `exportUpload`, `exportRemove`; `dashboard/components/ExportForm.tsx`.
