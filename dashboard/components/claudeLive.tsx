"use client";
// A run that runs in Claude, while its session is going (2026-11-27): a live line with the time since the routine
// started, a link to the session, and a quiet check every 10 s (30 s after ten minutes) for the session's result.
// When finish_run lands, the page reloads its data once to show it. Nothing here changes the run.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FINISH, elapsedWords, pollMs } from "@/core/routine-rules";

export function ClaudeLive({ runId, firedAt, url }: { runId: string; firedAt: string; url: string | null }) {
  const router = useRouter();
  const start = Date.parse(firedAt);
  const [now, setNow] = useState(() => Date.now());
  const [lost, setLost] = useState(false);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/runs/${runId}/claude`, { cache: "no-store" });
          if (r.ok) {
            setLost(false);
            const j = (await r.json()) as { running?: boolean };
            if (j.running === false) { router.refresh(); return; } // refresh-ok: the Claude session posted its result, so the page shows it
          } else setLost(true);
        } catch { setLost(true); }
      }
      timer = setTimeout(check, pollMs(Date.now() - start));
    };
    timer = setTimeout(check, pollMs(Date.now() - start));
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [runId, start, router]);

  return (
    <div className="claude-live" role="status" aria-live="polite">
      <div className="row" style={{ gap: 10 }}>
        <span className="dot pulse" style={{ width: 10, height: 10, background: "var(--acc)", flex: "none" }} />
        <span style={{ fontSize: 15, fontWeight: 600 }}>Running in Claude</span>
        <span className="muted" style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{elapsedWords(now - start)}</span>
      </div>
      <span className="ink2" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
        The routine is working in its own Claude session. Its result shows here by itself as soon as the session calls finish_run. With nothing back in {FINISH.withinHours} hours, the run is marked failed.
      </span>
      <div className="row wrap" style={{ gap: 8 }}>
        {url && <a className="btn ghost xs" href={url} target="_blank" rel="noopener noreferrer" style={{ height: 32, fontSize: 12.5 }}>Watch the session in Claude</a>}
        {lost && <span className="muted" style={{ fontSize: 12.5 }}>Can’t check right now; trying again.</span>}
      </div>
    </div>
  );
}
