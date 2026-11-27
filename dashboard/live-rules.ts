// The live-run poll (slice 1 of the click-speed fix, docs/speed.md rule 10). Pure: no database, no React.
// While a run is live the browser asks a small route (/live) which runs are live now, every few seconds, and
// renders the page again only when that set changes (a run started or finished) or when the page on screen is
// a live run's own page. Before, it rendered the whole app every 4 s whether anything had changed or not.

export const LIVE_POLL_MS = 4000;

/** The live run ids as one comparable key: sorted, so the order a reply lists them in doesn't matter. */
export const liveKey = (ids: readonly string[]) => [...new Set(ids)].sort().join(",");

/**
 * Should this poll render the page again? Only when the server's live set differs from the one the page was
 * drawn with, and we haven't already asked for a render for that same set (so a page that keeps disagreeing,
 * say a run the frame doesn't list, is rendered once, not every tick). A live run's own page always renders,
 * since its steps arrive while it runs.
 */
export function shouldRefresh(o: { shown: string; got: string; lastAsked: string | null; watching: boolean }): boolean {
  if (o.watching) return true;
  return o.got !== o.shown && o.got !== o.lastAsked;
}

/** The run a path shows, when it is a run's own page (/runs/<id>), else null. */
export const runOfPath = (path: string) => path.match(/^\/runs\/([0-9a-f-]{36})(?:\/|$)/)?.[1] ?? null;
