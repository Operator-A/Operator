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

## Next slices

2. Ask a model: a quick step with the Runs on model list, one instruction, text back, no tools, capped per step and
   billed to the owner's daily budget.
3. Wait for my OK: an approval card with the step before's result; approve to go on, reject to stop, 3 days to answer.
4. Make an image: OpenAI or Gemini images on the business's keys, stored with the run (new storage and a database
   change, asked before applying).
5. Run view: one chain run as a timeline of its steps.
