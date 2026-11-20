// The choice of how agents think (card 162): OPERATOR's hosted Claude on credits (cloud edition only,
// through the HostedClaude slot) or the business's own Claude key. Shown on setup step 1 until Avery
// can think, and on Connections > Claude. Server component: tapping an option is a link (?claude=…).
import Link from "next/link";
import { extensions } from "@/core/extensions";
import type { ReturnPlace } from "@/core/extension-types";
import { CHOICE_WORDS, claudeOptions, inUse, type ClaudeChoice, type ClaudeState } from "@/core/claude-choice-rules";
import { KeyForm } from "@/dashboard/components/client";
import { claudeSaveKey } from "@/dashboard/connectionActions";

const PAGE: Record<Exclude<ReturnPlace, "settings">, { path: string; hash: string }> = {
  start: { path: "/start", hash: "" },
  connections: { path: "/connections", hash: "#claude" },
};

export function ClaudeChoice({ state, picked, owner, back, query }: {
  state: ClaudeState; picked: ClaudeChoice; owner: boolean; back: Exclude<ReturnPlace, "settings">; query: Readonly<Record<string, string | undefined>>;
}) {
  const Hosted = extensions.HostedClaude;
  // an edition without the slot offers the own key alone, whatever claudeOptions says
  const options = claudeOptions(state.edition).filter((o) => o === "own" || Hosted);
  const show: ClaudeChoice = options.includes(picked) ? picked : "own";
  const using = inUse(state);
  const page = PAGE[back];
  return (
    <div className="stack" style={{ gap: 12 }}>
      {options.length > 1 && (
        <div role="radiogroup" aria-label="How your agents think" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {options.map((o) => (
            <Link key={o} role="radio" aria-checked={show === o} href={`${page.path}?claude=${o}${page.hash}`} scroll={false} className="card"
              style={{ gap: 6, padding: 14, textDecoration: "none", color: "var(--ink)", outline: show === o ? "2px solid var(--ink)" : undefined }}>
              <span className="row" style={{ gap: 8, justifyContent: "space-between" }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{CHOICE_WORDS[o].title}</span>
                {using === o ? <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>In use</span>
                  : o === options[0] && !using ? <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>Easiest</span> : null}
              </span>
              <span className="ink2" style={{ fontSize: 13 }}>{CHOICE_WORDS[o].line}</span>
            </Link>
          ))}
        </div>
      )}
      <div className="card stack" style={{ gap: 10, background: "var(--soft)" }}>
        {show === "hosted" && Hosted ? (
          <>
            {state.ownKey && <span className="soft-box" style={{ fontSize: 13 }}>Your own key comes first while it is saved. Forget it on Connections to run on credits.</span>}
            <Hosted back={back} owner={owner} query={query} />
          </>
        ) : (
          <>
            <span style={{ fontSize: 14 }}>
              {state.ownKey
                ? (state.ownKeyPaused ? "Anthropic stopped accepting the saved key. Paste a new one." : "Your own key is saved in the vault. Anthropic bills it directly; spend also shows in the run log.")
                : "Make a key in the Claude Console (Settings, then API keys) and paste it here. It is locked in the vault and never shown again."}
            </span>
            {owner ? <KeyForm label="Claude API key" save={claudeSaveKey} placeholder="sk-ant-…" replace={state.ownKey} /> : <span className="sub">Ask an owner of this business to paste it.</span>}
          </>
        )}
      </div>
    </div>
  );
}
