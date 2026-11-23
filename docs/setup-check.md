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

## Shopify and QuickBooks, and Fix it for me (card 282)

- `shopify_setup` counts, in code, active products (up to 50) with thin (under 120 characters) or missing
  descriptions, missing search title or description, or no tags, and the last 30 days' orders and customers
  with no tags. `quickbooks_setup` counts expense lines in Uncategorized Expense (90 days), expense accounts
  and unpaid bills (open, overdue, due soon). Both reuse existing fixed reads; no new scopes or server tools.
- A finding may name one of its tool's fixes (`FIXES`): `shopify.update_copy`, `shopify.add_tags` or
  `quickbooks.categorize_expense`, each an existing gateway action type that starts at Draft.
- **Fix it for me** (owner): code picks an agent that already holds that action *and* the reads it needs
  (`fixAgents`). It runs as that agent's manual run through `withRun` (its duty switch, budget and standing
  orders hold), held to just those tools and `FIX_LIMITS`, and may stage at most 5 changes. Each one is an
  ordinary approval card. The finding shows what it staged, counted in code.
- With no such agent, nothing runs: the card links to an agent's Tools step to give it the action. A check
  or fix never grants a tool.

## Meta Ads (card 283)

- `meta_setup` is a new read tool on our own Meta server, on the agents' `ads_read` sign-in (no new
  permission). For up to 3 active ad accounts it GETs the pixels (up to 3 each) with when each last fired,
  the last 7 days of events by name (all, and server-sent only, from Meta's pixel stats), and the active ad
  sets' learning stage. It never POSTs. Each part is read softly: a part Meta refuses is listed as unread,
  not guessed.
- `meta_ads_setup` (catalog) gives the agent the counts worked out in code (`META_SETUP_KEYS`): pixels never
  fired or unavailable, hours since one last fired, purchase and add-to-cart events, server events, ad sets
  in learning or learning limited, spend all time.
- The one fix is `meta.pause_ad`, the existing pause action (Draft, over-target ads only, no budget change).
- Migration `20261231090000_setup_checks_meta.sql` widens `setup_checks.tool` to `meta`.

## Klaviyo, Mailchimp, and re-checks (card 284)

- `klaviyo_setup` reads, on Klaviyo's read-only server and the existing scopes (`flows:read` was already
  asked for), every flow's name, status and trigger (`get_flows` with fixed fields, never a flow's actions or
  messages), the lists and the metric names. Code counts flows by status and trigger and whether Placed
  Order, Started Checkout, Viewed Product and Active on Site reach Klaviyo (`KLAVIYO_SETUP_KEYS`).
- `mailchimp_account_setup` reads `mailchimp_setup`, a new read on our own Mailchimp server: three fixed GETs
  (classic automations, each audience's welcome and double opt-in settings, connected stores and their
  abandoned cart and browse automations), never a member or an email address. Mailchimp's API doesn't list
  Customer Journeys, and the read says so. A part Mailchimp refuses is unread, not zero.
- Neither has a fix: the agent's finding has its steps, and the founder does it in the tool.
- **Re-checks.** A finding the founder skipped comes back once, `RECHECK_DAYS` (21) after the skip, as a
  proposal ("Finish setup") from the head of the department whose agent reads that tool, or from the company
  seat when none does (`recheckFrom`). The scheduler files it in code while the org is on, at most 3 a round;
  no model runs. The finding is marked returned before the proposal is filed, so it never comes back twice.
  The owner's yes opens it again on Connections; nothing in the tool changes.
- Migration `20270101090000_setup_checks_email.sql`: `setup_checks.tool` takes `klaviyo` and `mailchimp`, and
  `proposals.kind` takes `setup_finding`.

## Staff-reviewed how-tos (card 285)

Decided 2026-11-23: staff review a how-to first, then every business gets it. Cloud edition only.

- **What staff see.** Each business's shared-brain snapshot adds the tools it ran a check on and each gap's
  topic tag (`tool:topic`), never a title, step or word (`snapshotGaps`; `brain_snapshots.setup_checked`,
  `setup_gaps`). `brain_patterns()` counts `gap:<tool>:<topic>` among businesses that checked that tool, with
  the same floor of 5. Settings > Playbook (admin business owners only) lists those gaps, marks the ones with
  a how-to, and opens a how-to form for the rest (`recurringGaps` in `ee/brain.ts`).
- **A how-to** is a playbook lesson with a tool, a topic tag, up to 8 steps and a page on that tool's help
  site, checked by the setup check's own rules (`readHowTo`) and again in the table. Gap patterns are never
  put into the Hindsight bank; how-to lessons sync like any other lesson.
- **The check uses it.** The `setupHowTos` slot gives the setup agent the published how-tos for its tool
  (checked again in `core/extensions.ts`; empty in the open edition). When a gap matches one, the agent
  files it with that topic, those steps and that page, with no web search; a finding with a how-to's page is
  kept without fetching it (`keepFindings`). Other gaps are looked up as before.
- Migration `20270102090000_setup_howtos.sql`.

## Later slices

None planned: the setup check epic (280) is complete with card 285.

Tests: `npm run check:setup-check`; the GA4 read in `npm run check:mcp`; gap counting in `npm run check:brain`; how-to lessons in `npm run check:ee`.
