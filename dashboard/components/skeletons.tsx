// Small placeholders for the slow part of a page (card 303, docs/speed.md): the page's title, tabs and
// fast cards draw at once, and each slow part (goal numbers read from the tools, a connection's
// account details) streams in behind a <Suspense> that shows one of these. Same look as the whole-page
// loading frame (app/(room)/loading.tsx, the .skel classes in app/globals.css).

export function SkelLine({ width = "60%" }: { width?: string }) {
  return <span className="skel skel-line" style={{ display: "block", width }} role="status" aria-label="Loading" />;
}

export function SkelTiles({ n = 3 }: { n?: number }) {
  return (
    <div className="skel-grid" role="status" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => <div key={i} className="skel skel-card" />)}
    </div>
  );
}

export function SkelPane() {
  return (
    <div className="stack" role="status" aria-label="Loading" style={{ gap: 14 }}>
      <div className="skel skel-title" />
      <div className="skel skel-line" style={{ width: "70%" }} />
      <div className="skel skel-card tall" />
    </div>
  );
}

/** An agent's sheet while its data loads (click-speed slice 4): the sheet slides in at once, its parts fill in after. */
export function SheetSkel() {
  return (
    <>
      <div className="ag-bg open" />
      <aside className="ag open" aria-label="Loading" role="status">
        <div className="stack" style={{ gap: 14, padding: 20 }}>
          <div className="skel skel-title" />
          <div className="skel skel-line" style={{ width: "55%" }} />
          <div className="skel skel-card tall" />
          <div className="skel skel-card" />
        </div>
      </aside>
    </>
  );
}

/** A department or the Company page while it loads: the same frame as the page (`.dp`), so phones show the floating
 *  header (menu, title pill, bell) and the glass tab bar at once instead of the plain top bar, and desktops show the
 *  header row and tab bar in place. Only the words are placeholders. */
export function DeptSkel() {
  return (
    <div className="dp dp-skel" role="status" aria-live="polite" aria-label="Loading">
      <div className="dp-ttl" aria-hidden><span className="skel skel-line" style={{ width: "52%", height: 12 }} /><span className="skel skel-line" style={{ width: "36%", height: 9, marginTop: 4 }} /></div>
      <div className="dp-head" aria-hidden>
        <div className="skel" style={{ width: 52, height: 52, borderRadius: 16 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}><div className="skel skel-title" style={{ width: "38%" }} /><div className="skel skel-line" style={{ width: "26%" }} /></div>
      </div>
      <div className="dp-stage">
        <div className="dp-tabs" aria-hidden style={{ "--n": 1 } as React.CSSProperties}><span className="skel dp-skel-tabs" /></div>
        <div className="dp-pane">
          <div className="dp-scroll">
            <div className="skel skel-card" />
            <div className="skel skel-card" />
            <div className="skel skel-card tall" />
          </div>
        </div>
      </div>
    </div>
  );
}
