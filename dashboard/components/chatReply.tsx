// A chat reply with its light formatting (dashboard/chat-ui.ts), shared by Avery's chat and a department
// head's chat: React elements only, never HTML, never links.
import { parseReply, type Inline } from "@/dashboard/chat-ui";

function Line({ parts }: { parts: Inline[] }) {
  return <>{parts.map((p, i) => p.kind === "b" ? <b key={i}>{p.text}</b> : p.kind === "i" ? <em key={i}>{p.text}</em> : p.kind === "code" ? <code key={i}>{p.text}</code> : <span key={i}>{p.text}</span>)}</>;
}
export function Reply({ text }: { text: string }) {
  return (
    <div className="avery-md">
      {parseReply(text).map((b, i) =>
        b.kind === "h" ? <b key={i} className="avery-md-h"><Line parts={b.text} /></b>
        : b.kind === "p" ? <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}<Line parts={l} /></span>)}</p>
        : b.kind === "ul" ? <ul key={i}>{b.items.map((it, j) => <li key={j}><Line parts={it} /></li>)}</ul>
        : <ol key={i} start={b.start}>{b.items.map((it, j) => <li key={j}><Line parts={it} /></li>)}</ol>)}
    </div>
  );
}

