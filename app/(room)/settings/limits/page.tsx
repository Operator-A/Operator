// Settings > Limits (docs/settings.md): the crew-wide money and email caps, the only payees, and the
// addresses no agent emails. Every one is enforced in code by the gateway.
import { addVendor, setCap, suppressEmail } from "@/dashboard/actions";
import { getVendorsAndSuppressions } from "@/dashboard/data";
import { capLines } from "@/dashboard/guardrails";
import { controlsOn } from "@/dashboard/session";
import { CapForm, SuppressForm, VendorForm } from "@/dashboard/components/settingsForms";
import { SectionHead } from "@/dashboard/components/settingsHead";
import { orgTz } from "@/core/tz";

const line = (k: React.ReactNode, v: React.ReactNode, first?: boolean) => (
  <div className={"set-row" + (first ? "" : " rule")}><span className="set-row-k">{k}</span>{v}</div>
);

export default async function Limits() {
  const [caps, lists, tz] = await Promise.all([capLines(), getVendorsAndSuppressions(), orgTz()]);
  const controls = controlsOn();
  return (
    <>
      <SectionHead title="Limits" sub="What every agent may spend and send, who it may pay, and who it never emails. Enforced in code by the gateway." />
      <div className="card set-card pad" id="caps" style={{ gap: 0 }}>
        <span className="card-t">Money and email caps</span>
        <span className="sub" style={{ paddingBottom: 6 }}>Lowering a cap applies right away. Raising needs a confirm{controls ? "" : ", and real runs switched on for this OPERATOR"}, and stops at the limit in code. Trust levels aren’t editable here.</span>
        {caps.problem && <span className="sub">{/policy_log|relation/.test(caps.problem) ? "The caps migration (20261112230000_caps_and_vendors.sql) isn’t applied yet." : caps.problem}</span>}
        {caps.caps?.map((c) => <CapForm key={`${c.key}:${c.value}`} c={c} controls={controls} save={setCap} />)}
        {caps.log.length > 0 && (
          <details style={{ paddingTop: 10 }}>
            <summary className="sub">Recent changes</summary>
            {caps.log.map((l, i) => <div key={i} className="sub" style={{ padding: "4px 0" }}>{l.key}: {l.from ?? "default"} to {l.to} · {l.by} · {new Date(l.at).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>)}
          </details>
        )}
      </div>

      <div className="card set-card pad" id="vendors">
        <span className="card-t">Vendors</span>
        <span className="sub">The only payees an agent may ever pay. Only you add them, here. A first payment to a vendor always waits for your approval and is never promoted. No payment action exists yet.</span>
        {lists == null ? <span className="sub">The caps migration (20261112230000_caps_and_vendors.sql) isn’t applied yet.</span> : (
          <>
            {lists.vendors.length ? <div>{lists.vendors.map((v, i) => <div key={v.id}>{line(<>{v.name}<span className="muted set-hint">{v.kind}{v.contact_email ? ` · ${v.contact_email}` : ""}</span></>, <span className="sub">{v.mercury_recipient_id ? "Mercury recipient linked" : "No Mercury recipient yet"}</span>, i === 0)}</div>)}</div> : <span className="sub">No vendors yet.</span>}
            <VendorForm add={addVendor} controls={controls} />
          </>
        )}
      </div>

      <div className="card set-card pad" id="no-email">
        <span className="card-t">Addresses that get no email</span>
        <span className="sub">An unsubscribe or a “stop” reply lands here, and no agent emails that address again. You can add one too.</span>
        {lists && (
          <>
            {lists.suppressed.length ? <div>{lists.suppressed.map((x, i) => <div key={x.email}>{line(<><span style={{ overflowWrap: "anywhere" }}>{x.email}</span><span className="muted set-hint">{x.reason ?? ""}</span></>, <span className="sub">{x.source}</span>, i === 0)}</div>)}</div> : <span className="sub">None yet.</span>}
            <SuppressForm suppress={suppressEmail} />
          </>
        )}
      </div>
    </>
  );
}
