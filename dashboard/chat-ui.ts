// Avery's chat panel, the parts that are plain code (card 290; dashboard/components/avery.tsx draws them):
// how a reply's light formatting is read, how wide the panel may be dragged, and what each close does.
// No React and no browser here, so scripts/check-chat-ui.ts can test it.

/** A run of text inside a line. Never HTML and never a link: model text must not choose a URL. */
export type Inline = { kind: "text" | "b" | "i" | "code"; text: string };
export type Block =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "h"; text: Inline[] }
  | { kind: "ul" | "ol"; items: Inline[][]; start: number };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/;

/** **bold**, __bold__, *italic*, _italic_ and `code`. Anything unmatched stays as typed. */
export function inline(line: string): Inline[] {
  const out: Inline[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*|(?<![\w])_[^_\s][^_\n]*_(?![\w]))/g;
  let at = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > at) out.push({ kind: "text", text: line.slice(at, m.index) });
    const s = m[0];
    if (m[1]) out.push({ kind: "code", text: s.slice(1, -1) });
    else if (m[2]) out.push({ kind: "b", text: s.slice(2, -2) });
    else out.push({ kind: "i", text: s.slice(1, -1) });
    at = m.index + s.length;
  }
  if (at < line.length) out.push({ kind: "text", text: line.slice(at) });
  return out;
}

/** A reply as blocks: paragraphs (single line breaks kept), bullet and numbered lists, short headings. */
export function parseReply(text: string): Block[] {
  const blocks: Block[] = [];
  let para: Inline[][] | null = null;
  let list: Extract<Block, { kind: "ul" | "ol" }> | null = null;
  const end = () => { para = null; list = null; };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { end(); continue; }
    const h = HEADING.exec(line);
    const b = BULLET.exec(line);
    const n = NUMBERED.exec(line);
    if (h) { end(); blocks.push({ kind: "h", text: inline(h[1]) }); continue; }
    if (b || n) {
      const kind = b ? "ul" : "ol";
      if (!list || list.kind !== kind) {
        para = null;
        list = { kind, items: [], start: n ? Number(n[1]) : 1 };
        blocks.push(list);
      }
      list.items.push(inline((b ? b[1] : n![2]).trim()));
      continue;
    }
    // an indented line right under a list item carries on that item
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1].push({ kind: "text", text: " " }, ...inline(line.trim())); continue; }
    list = null;
    if (!para) { para = []; blocks.push({ kind: "p", lines: para }); }
    para.push(inline(line));
  }
  return blocks;
}

// the panel's width on a wide screen: dragged by its left edge, kept in this browser only
export const WIDTH = { min: 320, max: 720, def: 380, step: 24, ofWindow: 0.6 } as const;

/** Where the panel starts before it is dragged: narrower on a smaller screen, so the page keeps its room. */
export function defaultWidth(windowWidth: number): number {
  return windowWidth <= 1100 ? WIDTH.min : WIDTH.def;
}

/** A width the panel may take in a window this wide: never under the minimum, never over 60% of the window. */
export function clampWidth(w: number, windowWidth: number): number {
  const most = Math.max(WIDTH.min, Math.min(WIDTH.max, Math.floor(windowWidth * WIDTH.ofWindow)));
  if (!Number.isFinite(w)) return Math.min(defaultWidth(windowWidth), most);
  return Math.round(Math.min(most, Math.max(WIDTH.min, w)));
}

/** A stored width read back, or the default when there is none or it is not a number. */
export function storedWidth(raw: string | null, windowWidth: number): number {
  const n = raw == null ? NaN : Number(raw);
  return clampWidth(Number.isFinite(n) ? n : defaultWidth(windowWidth), windowWidth);
}

/**
 * What a close does. The phone sheet closes only itself; only closing the side panel on a wide screen
 * changes what this browser remembers (and never on the Desk, where the panel always starts open).
 */
export function closeEffect(sheetOpen: boolean, path: string): { sheet: "close" | "keep"; panel: "close" | "keep"; remember: "closed" | null } {
  if (sheetOpen) return { sheet: "close", panel: "keep", remember: null };
  return { sheet: "keep", panel: "close", remember: path === "/" ? null : "closed" };
}
