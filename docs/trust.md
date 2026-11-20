# Trust levels (card 7)

Trust is earned per agent and per kind of action (a gateway write tool), never for an agent as a whole.

| Level | What happens |
| --- | --- |
| Draft | An approval card. Nothing goes out until an approver taps Approve. Every action type starts here. |
| Act with undo | The action waits `undo_window_minutes` (Settings, start 30), shown on Approvals under "Going out on earned trust". An approver can cancel it. After the window the scheduler (`/api/dispatch`, every 15 minutes) approves and applies it. |
| Act | The scheduler applies it on its next round, logged in the gateway log. |

Every level goes through the same gateway: the allow-list, caps and refusals run when the action is proposed, and the live re-checks run again right before the write, inside `withRun` (so only while the agent is on duty) and only with `DASHBOARD_CONTROLS=on`.

**Promotion.** Counted in code (`core/trust-rules.ts`) from the record since the level last changed: at Draft, decided approvals (approved unedited is clean; edited or rejected is not; expired and sent back don't count); at Act with undo, scheduled actions (applied is clean, cancelled is not). With at least 30 decided, 28 of the last 30 clean and no "wrong" or "against the rules" among them, a promotion card appears on Approvals. Only the owner's tap on it moves the level up one (`acceptOffer`, which checks the record again). "Not yet" offers it again after 10 more decisions.

**Never promoted.** A tool with `promotable: false` in `core/gateway/policy.ts` (a first email to a lead) runs at Draft whatever the table says. A payment to a new payee will be the same when payments exist.

**Back to Draft, at once.** A rejection marked "It got this wrong" or "Against the rules", a scheduled action cancelled as wrong, a cap breach (`onBreach`), or an approver's "Back to Draft" on Approvals. Anything still in its undo window for that agent and tool is cancelled. Future complaint, unsubscribe and breaker signals call `demote()` in `core/trust.ts`.

**Data.** `trust_levels` (migration `20261225090000_trust_levels.sql`): one row per agent and tool that has ever moved, with the open promotion card. No row means Draft. `agent_actions` gains `scheduled` and `cancelled`, `execute_after`, `level` and `cancel_kind`; `approvals` gains `reject_kind`.

**Not built yet.** Editing an approval before approving it (until then every approval counts as unedited), and an Undo button for an action already applied.
