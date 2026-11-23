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
