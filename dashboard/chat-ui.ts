// How a chat reply's light formatting is read (card 290; dashboard/components/chatReply.tsx draws it), for
// Avery's chat on the Company page and every head's chat. No React and no browser here, so
// scripts/check-chat-ui.ts can test it.

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
