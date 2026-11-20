// Shown the moment a Control Room link is clicked, while the next page renders on the server
// (card 201, docs/speed.md). The sidebar, top bar and Avery's chat stay as they are: this fills
// only the main column. It is also the line Next.js pre-loads dynamic pages up to, so a click
// never waits on a blank pause.
export default function Loading() {
  return (
    <div className="skel-page" role="status" aria-live="polite" aria-label="Loading">
      <div className="skel skel-title" />
      <div className="skel skel-line" style={{ width: "42%" }} />
      <div className="skel-grid">
        <div className="skel skel-card" />
        <div className="skel skel-card" />
        <div className="skel skel-card" />
      </div>
      <div className="skel skel-card tall" />
    </div>
  );
}
