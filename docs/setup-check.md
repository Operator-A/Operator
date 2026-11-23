# Setup check

Card 281 (epic 280), decided 2026-11-22. Right after a business connects a tool, a setup agent reads how
that tool is set up and lists what is missing for this business, each with click-by-click steps from the
tool's own help site. It changes nothing in the tool. Slice 1 checks Google Analytics.

## Who judges what

- **The agent judges.** There is no checklist in code: tools change too often (decided 2026-11-22). The
  setup agent (the Chief of Staff's seat, `SETUP_AGENT`) runs on `SETUP_CHECK_MODEL` with medium thinking.
- **Code reads and counts.** Each tool has one wide settings read named in code and on its MCP profile
  (Analytics: `analytics_setup`, served by `ga4_setup` on our own GA4 server: property, data retention, key
  events, data streams, Google Ads links, and two fixed reports). Numbers are worked out in code, including
  the store comparison (`calc_sales_gap`: Shopify's last 30 days against Analytics' purchase revenue).
  A part Google won't give is null and listed in `unread`, never a zero.
- **Code checks every finding** (`readFinding` in `core/setup-check-rules.ts`): a severity (broken, worth
  fixing, good), a topic tag, a title and why, evidence keys that the reads really return, at most 8 steps,
  and for a gap a help link on the tool's help site (plus a connected store's). After the run, a finding
  whose link was not a page the run fetched is dropped (`keepFindings`).

## Untrusted input

Account names and help pages are untrusted. Web search and fetch are held to the help domains and
`HELP_USES` each. Nothing read chooses a recipient, URL, product or category; the link shown is checked
against the domains and the pages fetched. Steps are plain text (text params refuse links).

## Running and paying

- **Check my setup** (owner, `DASHBOARD_CONTROLS=on`, tool connected) claims the row and runs in the
  background (`after()` with the org carried), so the founder isn't held for a minute or two. The card
  polls `setupCheckState`. A row still running after 10 minutes counts as failed and can run again.
- Every check is a logged run through `withRun`. In setup, before any department exists, it is a `setup`
  run and counts against free setup (`SETUP_FREE_USD`, $3 since 2026-11-22); otherwise a `preview` run on
  credits. In setup the first `SETUP_CHECKS_FREE` tools are checked on their own; later ones get a button.
- Its own limits: `SETUP_CHECK_LIMITS` (16 steps, $0.30), about $0.25 a tool.
- Findings are saved in `setup_checks` (one row per business and tool) only after a run that finished.

## Where it shows

- The tool's card in setup, after its snapshot.
- Connections, Google Analytics, once a property is picked.
- The Desk: "Setup you skipped" lists skipped findings with their steps and Open again.
- Avery's next setup reply gets one line counted in code (`checkNote`).

## Later slices

282 Fix it for me on Shopify and QuickBooks through existing action types; 283 Meta Ads; 284 Klaviyo and
Mailchimp, and heads re-checking; 285 reuse setup how-tos staff reviewed and published to the shared
playbook (decided 2026-11-23), so fewer checks need a web search.

Tests: `npm run check:setup-check`; the GA4 read in `npm run check:mcp`.
