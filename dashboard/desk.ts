// The day’s greeting on the Company page (docs/department-pages.md, slice 8; was the Desk), worked out in code. Pure, so
// `npm run check:chat` can test it.


/** "Good morning" before noon in the business's time zone, "Good afternoon" until 5 PM, then "Good evening". */
export function deskGreeting(now: number, tz: string): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date(now)));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The first sentence of an agent's words, cut to a length, for a tile or a card. */
export function firstSentence(text: string | null | undefined, max = 160): string {
  const t = String(text ?? "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{20,}?[.!?])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
