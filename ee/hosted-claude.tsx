// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The HostedClaude slot (card 162): OPERATOR's own Claude, paid from managed credits, as an option on
// setup step 1 and Connections > Claude. Shows the balance and the price, and for an owner the
// buttons to buy a pack on Stripe Checkout, which comes back to the page it was bought from.
import "server-only";
import type { ReturnPlace } from "@/core/extension-types";
import { stripeReady } from "./stripe";
import { buyCredits } from "./billing-actions";
import { creditBalance, creditsReady } from "./credits";
import { MIN_BALANCE_USD, PACKS_USD, usdWords } from "./credit-rules";
import { CREDITS_MARGIN } from "@/core/cost-rules";

export async function HostedClaude({ back, owner, query }: { back: ReturnPlace; owner: boolean; query: Readonly<Record<string, string | undefined>> }) {
  const balance = await creditBalance().then((b) => ({ b, problem: null as string | null }), (e: unknown) => ({ b: 0, problem: e instanceof Error ? e.message : String(e) }));
  const ready = stripeReady() && creditsReady();
  const enough = balance.b >= MIN_BALANCE_USD;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span style={{ fontSize: 14 }}>
        {balance.problem ?? (enough
          ? <>You have <b>{usdWords(balance.b)}</b> of Claude credits. Each run is charged its model price plus {Math.round((CREDITS_MARGIN - 1) * 100)}%, and runs pause below {usdWords(MIN_BALANCE_USD)}.</>
          : <>Buy a pack of credits to start. Each run is charged its model price plus {Math.round((CREDITS_MARGIN - 1) * 100)}%; a setup conversation usually costs a few cents. Credits never expire.</>)}
      </span>
      {query.credits === "added" && !enough && <span className="soft-box" role="status" style={{ fontSize: 13, background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Thanks, your credits are on the way. They can take a minute to arrive: refresh this page.</span>}
      {query.credits_problem && <span className="soft-box" role="alert" style={{ fontSize: 13, background: "var(--red-soft)", color: "var(--red-ink)" }}>{query.credits_problem.slice(0, 200)}</span>}
      {owner ? (ready ? (
        <div className="row wrap" style={{ gap: 8 }}>
          {PACKS_USD.map((p) => (
            <form key={p} action={buyCredits}>
              <input type="hidden" name="pack" value={p} />
              <input type="hidden" name="back" value={back} />
              <button className={enough ? "btn ghost sm" : "btn dark sm"}>Buy ${p}</button>
            </form>
          ))}
        </div>
      ) : <span className="muted" style={{ fontSize: 12.5 }}>OPERATOR’s Claude isn’t set up on this deployment yet. Use your own key for now.</span>)
        : <span className="sub">An owner of this business buys credits.</span>}
      <span className="muted" style={{ fontSize: 12 }}>Credits only pay for the model. Caps, budgets and approval cards are the same either way, and a key of your own always comes first.</span>
    </div>
  );
}
