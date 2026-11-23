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
4. **Pages you just saw come back at once** (checked, card 301). Next 16 keeps a visited Control Room page in
   the browser for 0 seconds by default, so every back-and-forth waited on the server again. `next.config.ts`
   sets `experimental.staleTimes` to 30 s (check:speed keeps it between 1 and 60). A save still shows fresh data
   at once: an action's `revalidatePath`, and the live-run refresher's `router.refresh()`, clear this cache.
5. **Navigation loads on intent** (checked, card 301). The sidebar and phone menu (`SideLink`), crew chips
   (`RailLink`), agent tabs (`AgentTabs`), Crew views and Settings sections use `IntentLink`
   (dashboard/components/intentLink.tsx): it loads the whole page, data too, the moment the pointer enters,
   a finger touches or the keyboard focuses the link, so the server starts before the click. Before that it
   pre-loads only up to the loading frame, so pages nobody points at cost nothing.

## What we measured (Nov 23, card 301)

From the Supabase API logs of the owner's own clicks: navigation already used `Link` everywhere (router.push only
after a save), so no page reloaded in full. Each click was a fresh server render: 20 to 27 queries in 4 to 6
rounds one after another (sign-in check, time zone, the floor, the page's own loads, sometimes the vault), about
0.4 s of database time warm and 1.5 s on a slow click. In a test app on the same Next.js version with a page that
takes 400 ms on the server: a plain click took 798 ms; a click after hovering 49 ms; going back to a page just
seen 68 ms with no server render. Cards 302-304 shorten the server render itself (one round of loads, page frame
first, each page reads only what it shows).

## The page frame draws first (card 303)

7. **Slow parts stream in** (checked). Anything that calls the business's tools waits on another service, so it
   sits in a `<Suspense>` with a small skeleton (dashboard/components/skeletons.tsx) while the rest of the page
   draws. That covers goal numbers (core/measures.ts) on the Desk and the Crew chart, a connection's detail on
   Connections (lists, account name, properties, setup check) and the Claude card. The Desk starts its goal reads
   without awaiting them: `DeskLine` and `DeskGoals` both wait on the same promise. In a test app on Next 16.3.6
   with a 1.2 s slow part, the title showed after 0.86 s instead of 1.88 s.

## Each page reads only what it shows (card 304)

8. **The floor is pieces** (checked). `getFloor` is five cached pieces sent in one round: `getRoster` (agents, live
   setups, chains, org chart, the last 60 days of runs), `getCounts` (what waits on the owner), `getHealth` (which
   tools are set up), `getTz` and `getOrgSwitch`. Each runs once per request however many places ask for it. Only
   the frame, the Desk, an agent, a run's replay, Crew and the first-job action take the whole floor, because they
   show all of it. Settings asks only for the org switch, People only for the time zone, Runs and Approvals for the
   crew, Connections and the builder for `getCrewFloor` (crew, tools, time zone). On a client click the frame
   (app/(room)/layout.tsx) is not rendered again, so a click costs only the page's own pieces.
