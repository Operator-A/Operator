# The living Crew canvas

The owner, 2026-11-22: the Crew page should look alive and let you dig into each department. Keep the colours and glass of the setup pages. The chart should move and show how the agents work with each other, and it must keep the shape of an org chart. Each agent is a small card, not a letter in a circle. Approved mockup: https://claude.ai/artifact/UxUex8bXDMGk8CSEwEpi7r. Status lives on the Build Board.

**Rule for every slice: it deletes what it replaces in the same PR.**

## Decisions (2026-11-22)

- **Org chart shape.** You on top, the company seat under you, then a column per department with its head and the seats under it, each seat indented under the one it reports to. On a phone the departments sit two across.
- **Small cards.** A seat is a small card: a state dot, the agent's name (or the seat's name when it is open) and what the seat covers. An open seat is dashed. No initials, no faces.
- **Alive.** Each department column floats a little, lines curve, a hand-off line flows, and a pulse travels up a line when an agent ran. With reduced motion turned on the canvas holds still and keeps every line.
- **Open a department.** Clicking a department (or its chip) clears the others away, in place, with no page load. Its head and the seats right under it grow to say what each last did. Lines lead out to the company seat, to you and to any department it hands work to. A panel beside the canvas (under it on a phone) shows the department, and an agent when you click its card.
- **Every line is real.** A line is drawn only from data: a seat's parent on the org chart (reports), two steps in a row of a chain that is on, where the second takes the first's facts (hands work to). A pulse is a run from today. Nothing moves for decoration and no model writes anything on this page.
- **Read only.** The canvas changes nothing. Edit chart (`/crew?view=edit`) keeps the structured chart for seats, budgets, emails, rules and lead checks, with the same actions and server checks as before. Schedule (`/crew?view=schedule`) is unchanged.
- **Looks.** The setup pages' glass and soft light, kept inside the canvas. Unlike setup it follows the Control Room's light and dark theme.

## Slices

| # | Slice | Replaces (deleted in the same PR) |
|---|---|---|
| 1 | The canvas: whole company and an opened department, report and hand-off lines, today's runs as pulses, the department and agent panel | The read-only org chart on `/crew` and its phone folding (`DeptSummary`, the fold buttons, the team counts, their styles). `OrgChart.tsx` becomes the Edit chart view only. |
| 2 | What waits for you and draft checks: an amber line from an agent to you for each draft in Approvals, a green line where a lead checks a draft first, the count on each department and card | The "waiting" counts stay text-only until this slice; nothing else to delete |

## Slice 1: the canvas

**What it is.**

- **Crew** (`/crew`) opens on the canvas. Chips above it: Whole company and one per department. The view switch reads Canvas, Edit chart, Schedule.
- **Whole company.** You, the company seat, a column per department. A solid line runs from each seat to the seat it reports to, and from each head to the company seat. A dashed line runs between two agents where a chain that is on hands one's facts to the next. A department shows its name; a card shows a state dot (working now, on shift, on call, off duty, budget reached), the name and the seat.
- **An opened department.** The head on top, the seats right under it side by side, deeper seats as small cards under their lead. Opened cards add the state in words and the last run's summary. The panel shows the department's goals (the same tiles as before, each linking to its goal), this month's AI spend against its budget, its rules, how work moves (sentences written in code from the lines), its agents, and today's runs. Clicking an agent's card shows that agent: state, last run, what it does, who it reports to and hands work to, with links to its page and to replay its last run.
- **Pulses.** Each run from today (not skipped) plays as a dot travelling from that agent's card up its report line, coloured by how it ended, in a loop. The panel lists the same runs, newest first, with their summaries. Nothing is polled: the page shows the runs it loaded.
- **An open seat** links to New agent with the seat filled in (or to its proposal), as before. Agents in no seat are listed under the canvas, as before.

**Code.**

- `dashboard/org-canvas.ts` (pure, tested): the canvas data shape, `handoffsOf` (chains to hand-off lines), `layoutCanvas` (every box and line for a width and an opened department), `moveLines` (how work moves, in words).
- `dashboard/org.ts`: `canvasData` builds that shape from the org view, the active flow and today's runs.
- `dashboard/components/OrgCanvas.tsx` (client): draws the boxes, eases them to their places, draws lines and pulses on a `<canvas>`, holds which department and agent are open. It calls no action.
- `dashboard/components/OrgChart.tsx`: the Edit chart view only.
- `app/(room)/crew/page.tsx`: the three views. The canvas view loads the org, goals, proposals and the active flow; it does not load versions or the chain editor's data.
- Styles: `.lc-*` in `app/globals.css`.

**What it replaces.** The read-only chart and its phone folding, listed in the table above.

**Tests.** `npm run check:org-canvas`: for phone, tablet and desktop widths, with the whole company and with each department opened, every seat has a box, no two cards overlap, nothing leaves the canvas, every line joins two boxes that are showing, a report line exists for every seat with someone above it, and a hand-off line exists only for two steps in a row of a chain that is on with pass-along set. It also checks the deleted folding code and styles are gone and that the canvas component calls no server action. `npm run check`, `npm run build`.

**Not in this slice.** Lines for approvals and draft checks (slice 2). Live updates without a reload.
