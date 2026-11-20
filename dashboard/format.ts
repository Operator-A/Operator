// Display helpers. Every time is shown in the business's own time zone (card 187), which the caller
// passes: orgTz() on the server, or the tz a server page handed a client component (Floor.tz).
const cache = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string, key: string, o: Intl.DateTimeFormatOptions) => {
  const k = `${tz}|${key}`;
  let f = cache.get(k);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }); cache.set(k, f); }
  return f;
};

export const hm = (t: Date | string | number, tz: string) => fmt(tz, "hm", { hour: "numeric", minute: "2-digit" }).format(new Date(t));
export const md = (t: Date | string | number, tz: string) => fmt(tz, "md", { month: "short", day: "numeric" }).format(new Date(t));
export const dow = (t: Date | string | number, tz: string) => fmt(tz, "dow", { weekday: "short" }).format(new Date(t));
export const when = (t: Date | string | number, tz: string) => `${md(t, tz)}, ${hm(t, tz)}`;
export const longDay = (t: Date | string | number, tz: string) => fmt(tz, "long", { weekday: "long", month: "short", day: "numeric" }).format(new Date(t));
export const utcStr = (t: Date | string | number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export const m4 = (v: number) => "$" + v.toFixed(4);
export const m2 = (v: number) => "$" + v.toFixed(2);
export const budget = (v: number) => m2(v).replace(".00", "");
export const num = (n: number) => n.toLocaleString("en-US");

export function dur(start: string, end: string | null) {
  if (!end) return "—";
  const s = Math.max(0, (Date.parse(end) - Date.parse(start)) / 1000);
  return s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

export function rel(t: string | number, now = Date.now()) {
  const m = Math.round((now - new Date(t).getTime()) / 6e4);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "9:12 AM" → "9:12" for tight cells. */
export const shortHm = (t: Date | string | number, tz: string) => hm(t, tz).replace(/\s?[AP]M$/, "");

/** "06:45" → "6:45 AM" */
export function t12(s: string) {
  const [h, m] = s.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** Splits a run summary so Notion page links (written by our own code) render as links. Other URLs stay text. */
export function linkParts(s: string | null) {
  return String(s ?? "").split(/(https:\/\/\S+?)(?=[.,]?(?:\s|$))/).filter(Boolean).map((text) => {
    let url: string | null = null;
    try { const u = new URL(text); if (/(^|\.)notion\.(so|site|com)$/.test(u.hostname)) url = u.href; } catch { /* not a URL */ }
    return { text: url ? "Notion page" : text, url };
  });
}
