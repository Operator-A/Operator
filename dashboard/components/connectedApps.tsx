"use client";
// Settings > Connected apps (docs/operator-mcp.md). A member disconnects their own; an owner anyone's.
// The server checks again on every Disconnect.
import { useState, useTransition } from "react";
import type { ActionResult } from "@/dashboard/actions";
import { Toast } from "./client";

export interface AppLineView { id: string; client: string; email: string; you: boolean; connectedAt: string; lastUsedAt: string | null }

export function ConnectedApps({ apps, owner, tz, disconnect }: { apps: AppLineView[]; owner: boolean; tz: string; disconnect: (id: string) => Promise<ActionResult> }) {
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const when = (at: string) => new Date(at).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (!apps.length) return <span className="sub">Nothing is connected yet.</span>;
  return (
    <div className="stack" style={{ gap: 0 }}>
      {apps.map((a, i) => (
        <div key={a.id} className={"row wrap" + (i ? " rule" : "")} style={{ justifyContent: "space-between", padding: "12px 0", gap: 12, fontSize: 14 }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ overflowWrap: "anywhere" }}>{a.client}<span className="muted"> · {a.you ? "you" : a.email}</span></span>
            <span className="muted" style={{ fontSize: 12 }}>Connected {when(a.connectedAt)}{a.lastUsedAt ? ` · last used ${when(a.lastUsedAt)}` : ""}</span>
          </span>
          {(a.you || owner) && (
            <button className="btn ghost sm" disabled={busy} onClick={() => start(async () => {
              let r: ActionResult;
              try { r = await disconnect(a.id); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
              setToast(r);
            })}>Disconnect</button>
          )}
        </div>
      ))}
      {toast && <Toast t={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
