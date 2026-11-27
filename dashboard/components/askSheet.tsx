"use client";
// The chat behind a page's Ask button (overview slice 1): the same chat that was the page's first tab, in a sheet
// that slides in from the right (from the bottom on a phone). It is in the address (?ask=1), so back closes it,
// and a link that types words into the chat (?say=…) opens it with them typed in.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const X = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;

export function AskSheet({ title, sub, closeHref, children }: { title: string; sub: string; closeHref: string; children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", esc);
    return () => { cancelAnimationFrame(r); removeEventListener("keydown", esc); };
  });
  // the page under the sheet loads while the sheet slides away, not after (click-speed slice 4)
  function close() { setOpen(false); router.push(closeHref, { scroll: false }); }
  return (
    <>
      <div className={`ag-bg${open ? " open" : ""}`} onClick={close} />
      <aside className={`ag ask${open ? " open" : ""}`} aria-label={title} role="dialog" aria-modal="true">
        <div className="ag-h">
          <div className="dp-icon"><i /></div>
          <div><b>{title}</b><span>{sub}</span></div>
          <button type="button" className="x" onClick={close} aria-label="Close">{X}</button>
        </div>
        <div className="ask-body">{children}</div>
      </aside>
    </>
  );
}
