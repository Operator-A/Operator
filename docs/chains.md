# Chains for agents and departments

A chain is a start plus steps that run one after another, each step getting the one before's result as facts.
Approved design and mockup (2026-11-24): https://claude.ai/artifact/A41hpdTSKyUgGEY8xCirST. Build Board card 430.
Decided 2026-11-24: quick steps ("Ask a model", "Make an image", "Wait for my OK") are allowed, in later slices.

**Rule for every slice: it deletes what it replaces in the same PR.**

## Slice 1: chains where they live (built)

| What | Where |
| --- | --- |
| Every chain has an owner: an agent (`{ agent }`), a department (`{ dept }`) or none (the company). An agent's own one-step chain (`solo-<agent>`) counts as that agent's. The owner only decides where the chain is listed; it is never authority. | `Chain.owner`, `chainOwner` in `core/flow-rules.ts` |
| Up to 8 steps (was 3). | `MAX_STEPS` |
| A new start, "after another chain finishes": when that chain's last step ended OK (or either way), while the org is on and this chain is on. Its first step gets the last step's run as the step before, so "pass along" hands over that summary. Saving refuses a circle; reading the saved flow drops a circle and any chain after a dropped one; at most `MAX_HOPS` (5) chains in a row from one start. | `Start` `{ type: "after" }`, `followersOf`, `startFollowers` in `core/chain.ts`, `ChainCtx.hops` |
| A department page has a Chains tab: its own chains and its agents' chains as a list, and the open chain as a lane (start, steps, what passes between them, a "+" to add a step). | `ChainsBoard` in `dashboard/components/chains.tsx`, `boardGroups` and the lane helpers in `dashboard/chain-rules.ts` |
| The agent sheet lists the chains the agent is in, each opening where it lives, and "+ New chain starting with" the agent. | `chainsOf(..., href)`, `chainHref`, `newChainHref` |
| Settings > Schedule shows every chain on the same board (the company's first, then each department's) and the flow's versions with Roll back. It replaces the old Edit chains canvas, which is deleted. | `app/(room)/settings/schedule/page.tsx` |
| Saving is one chain at a time, merged into the saved flow (so two places never overwrite each other), checked again on the server, as a new flow version noted with where it was saved. A chain that starts running on its own, gains an agent or starts differently while on needs a confirm and Controls on. Owner only. Deleting a chain that another starts after is refused until that start changes. | `saveChain`, `deleteChain`, `withChain` in `dashboard/actions.ts` |
| Try it dry-runs each step of the open chain (no writes, no model, no cost). | `previewChain` |

No migration: the flow is JSON in `crew_flow`, and `jobs` payloads carry `hops`.

Rules it keeps: every step runs through `withRun` (on duty, daily budget, the run log); a skipped step stops the chain
and nothing starts after it; a step's result reaches the next step as facts, never instructions; nothing an email, web
page or model says chooses what runs next, only the saved chain; a chain never turns an agent on.

Tests: `npm run check:chains`.

## Slice 2: Ask a model (built)

| What | Where |
| --- | --- |
| A step is an agent (`{ agent }`) or an Ask a model step (`{ ask: { model, prompt, maxUsd } }`), never both. Any step can be one, the first included, and a chain can hold several. | `Step`, `Ask`, `askProblems` in `core/flow-rules.ts` |
| The model is one on OPERATOR's list (`integrations/models.ts`); one from another maker needs its key on Connections > Other models, checked when saving. The instruction is up to 2,000 characters. The cap is $0.01 to $1.00 a run (`ASK`), $0.10 to start. | `ASK`, `withChain` in `dashboard/actions.ts` |
| It gets the step before's result as facts when "Gets ... as facts" is ticked, marked as data in a `<facts>` block that can't close itself early. It has no tools, no reads and no memory; it sends, buys and posts nothing, and its answer never chooses what runs next. Its text is the run's summary, so the next step can get it. | `askMessages`, `keepText` in `core/ask-rules.ts`, `runAsk` in `core/ask-step.ts` |
| It is billed to the agent that pays for the chain: the owner agent, the department's head, or for the company's chains the company seat, through `withRun` as that agent (on duty, daily budget, department budget, the run log). A seat that is open or held by a person can't pay, so saving refuses and the step is skipped. | `billedBy`, `payerOf` in `core/ask-rules.ts`, `runChainStep` in `core/chain.ts`, `withRun(..., { quick: true })` |
| Answer length is set in code so input plus output stays under the cap (at most 4,000 tokens); input alone over the cap sends nothing and skips. Cost is worked out from the model's price. An answer cut at the cap says so. | `maxOutFor`, `costUsd` |
| On a chain that is on, a higher total Ask a model cap a run needs a confirm, like a new agent. | `flowLooser` |
| The lane's "+" offers Ask a model; its card shows the model, the instruction, the cap and who pays, with warnings (no payer, payer off duty, missing key, no instruction). Try it says what it would ask and sends nothing. | `dashboard/components/chains.tsx`, `previewChain` |

No migration: the step is JSON in `crew_flow`.

Tests: `npm run check:ask`.

## Slice 3: Wait for my OK (built)

A step `{ ok: { note? } }` (`core/flow-rules.ts` `okProblems`, `OK`). It never goes first (there is nothing to approve),
two never sit together, and it takes no check or pass along: the card always shows the step before's result.
Dropping an agent from a chain (by hand only) takes an OK left first or doubled with it.

- Running (`core/chain.ts`, `core/chain-ok.ts` `holdForOk`): no run, no model, no cost. Code keeps one `chain_oks` row
  (migration `20270108090000_chain_oks.sql`, one per chain run and step): how the chain was started, the step
  before's run, its summary and numbers cut in code (`keepFacts`), the department it shows in (`okDept`: the chain's
  own, its owner agent's, or none for the company) and `due_at`, 3 days on. The chain stops there.
- Deciding (`dashboard/actions.ts` `decideChainOk`, approvers only, audited): the row moves from pending once, and only
  before `due_at`. Approve reads the saved chain again and, if that step is still a Wait for my OK
  (`okStillHolds`), goes on with `continueChain` from it with the step before's run as the parent, so the next
  step gets that result as facts and meets its own checks (chain on, org on, duty, budget). Reject stops the chain.
- Expiry: the scheduler marks rows past `due_at` expired (`expireOks`); their chains stop.
- Cards (`ChainOkCard` in `dashboard/components/approvalBits.tsx`): on Company > Approvals and the department's
  Approvals tab, counted in the Approvals badge, the department's red count and the Company page's list. It holds a
  chain, not an action: no trust level, never promoted, and nothing a run wrote can approve it.

Tests: `npm run check:ok`.

## Slice 4: Make an image (built)

Decided 2026-11-24: pictures are kept in OPERATOR, private per business. A step
`{ image: { model, prompt, quality, size } }` (`core/image-rules.ts`): one model on `IMAGE_MODELS` (GPT Image 2.5
Flare, on the business's own OpenAI key), an instruction up to 1,500 characters, low, medium or high quality, square,
wide or tall. Its price is worked out in code from the provider's picture tokens ($30 per million) and the prompt
($5 per million), and counts toward the chain's quick-step total that needs a confirm when it rises (`flowLooser`).

- Running (`core/chain.ts`, `core/image-step.ts` `runImage`): billed like Ask a model, through `withRun` as the
  paying agent (`billedBy`, quick). One request through `imageClient` in `integrations/llm.ts` (the only file that
  opens model keys; no redirects, the key never in an error, a refused key paused). The step before's result, when
  passed along, is added as notes cut to 1,000 characters. The cost is the provider's own counts at our prices.
- Keeping: the private `chain-images` bucket, at `<org>/<run>.png`, with a `chain_images` row (migration
  `20270109090000_chain_images.sql`), deleted by the scheduler after 90 days (`pruneImages`). Read only through
  10-minute signed links: on the run page, and on a Wait for my OK card right after the step.
- The picture is never posted, sent or attached anywhere. A later step gets only a line saying a picture was made.

Tests: `npm run check:image`.

## Slice 5: Run view (built)

The run page of any run in a chain shows the whole chain run as the chains lane: a card per step, top to bottom
(`core/run-view-rules.ts` `timeline`, drawn by `dashboard/components/runView.tsx`).

- Each step: its name, where it ran (OPERATOR and its model, your Claude routine, the model asked, the image model on
  your key, or Approvals), how it went, when, what it cost and what it said. A picture a Make an image step made
  shows as a thumbnail through a short signed link. A Wait for my OK step shows who decided and when, or when it
  stops by itself.
- Between steps, what was passed on: the words handed to the next step, a line that a picture was made (never the
  picture), that the result went on the OK card, or nothing when the next step doesn't take it.
- The chain's total, worked out in code, and one line on how it ended: every step ran, still running, waiting for
  your OK, or where and why it stopped (failed, skipped, rejected, nobody answered, or the next step's conditions).
- Read from the chain as saved now plus this chain run's `agent_runs` and `chain_oks` rows (`getChainRuns`). When
  the chain can't be read, the runs alone are shown. A retried step shows its latest run.

Tests: `npm run check:runview`.

## Chains from Claude (card 435)

OPERATOR's MCP server (`docs/operator-mcp.md`) reads chains: `list_chains` gives every saved chain in words
(`core/chain-view-rules.ts`) plus the chain as saved, and `get_chain_run` gives one chain run as the run view, through
the same reader as the run page (`core/chain-view.ts`). Slice 2 adds `draft_chain`: a draft that changes nothing until
the owner uses it in OPERATOR, through the Chains tab's own save and its confirm.

Tests: `npm run check:mcp-chains`.
