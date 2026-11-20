# Speed: a click answers right away

Card 201 (and the cards after it). Why the Control Room and setup felt slow, and the rules that keep
them fast. `npm run check:speed` enforces the rules marked (checked).

## What we measured (Nov 20, from the Supabase API logs of one setup session)

- One click in setup was three trips to the server, one after another: the server action, the page
  rebuilt in the action's own reply (its `revalidatePath`), then the page rebuilt again because the
  button also called `router.refresh()`.
- One page build ran about 40 database queries (eleven of them one per tool connection). Sent at once,
  they queue: the same query took 130 ms or 760 ms within one click. A slow click spent about 1.4 s in
  the database, a warm one about 0.3 s.
- No route had a `loading.tsx`, so a menu click showed nothing until the server answered, and Next.js
  pre-loaded none of the (dynamic) Control Room pages.

## Rules

1. **One trip per click** (checked). A server action that changes something calls `revalidatePath` (or
   `refresh()` from `next/cache`) itself. In a server action that comes back in the same reply, so client
   code never calls `router.refresh()` after an action. A refresh with another reason (a cookie only the
   browser wrote, polling a live run) ends its line with `// refresh-ok: <reason>`. An action that changes
   nothing on screen is named in `READ_ONLY` in `scripts/check-speed.ts`.
2. **Something moves at once** (checked). `app/(room)/loading.tsx` fills the main column while the next
   page renders; the sidebar, top bar and Avery's chat stay. Buttons show their own busy state
   (`useTransition`) while an action runs.
3. **Load what the screen shows** (checked where it bit us). A page reads what it draws, in one parallel
   round. Card 202: every connection's status is one query (`mcpStatuses()` in integrations/mcp.ts, no
   secret read), not one per server; `getHealth()` (dashboard/data.ts) answers "which tools are set up" on
   its own, and setup uses it instead of the Desk's whole floor; the Control Room layout and the setup page
   start all their loads at once; the Mercury account name on the setup tools step (a call to Mercury) is
   kept 10 minutes per business.
