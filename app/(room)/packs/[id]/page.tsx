import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/dashboard/data";
import { packPageData } from "@/dashboard/packMarket";
import { costNote, costWords, packsHref, type DeptPage, type AgentPage } from "@/core/pack-market-rules";
import type { Conn, Row } from "@/core/pack-card-rules";
import { atLeast } from "@/core/roles";
import { installDeptPack } from "@/dashboard/packActions";
import { AddPackButton, PackIcon } from "@/dashboard/components/packMarket";

// A pack's page (docs/packs.md, packs slice 4; approved mockup screens 2 and 3): everything it adds before it's added.
// A department pack's page is its confirm step: Add installs it (owner only) and lands on the new department. An agent
// pack's page lists the open seats it fits; Fill opens that seat's sheet with the pack picked.
const fillHref = (deptId: string, seatId: string, pack: string) => `/dept/${encodeURIComponent(deptId)}?tab=agents&fill=${encodeURIComponent(seatId)}&pack=${encodeURIComponent(pack)}`;

const Conns = ({ conns }: { conns: Conn[] }) => conns.length ? <>
  <span className="pk-h6">Connections it reads</span>
  <div className="pk-list">{conns.map((c) => (
    <div key={c.tile} className="pk-li"><span className={`pk-dot ${c.connected ? "ok" : "warn"}`} /><span className="t"><b>{c.name}</b>, for {c.gives}<small>{c.sub}</small></span>{!c.connected && <Link href="/connections" className="dp-btn">Connect</Link>}</div>
  ))}</div>
</> : null;
const Rows = ({ rows }: { rows: Row[] }) => <>{rows.map((r) => (
  <div key={`${r.title}${r.rest}`} className="pk-li"><span className="t"><b>{r.title}</b>{r.rest}<small>{r.sub}</small></span>{r.off && <span className="pk-off">{r.off}</span>}</div>
))}</>;
const Hero = ({ p }: { p: DeptPage | AgentPage }) => (
  <div className="pm-hero"><PackIcon letter={p.letter} hue={p.hue} big /><div>
    <h1 className="h1">{p.name}</h1><p>{p.about}</p>
    <div className="pk-meta"><span className="pk-tag">{p.kind === "department" ? "Department pack" : "Agent pack"}</span><span className="pk-tag">Built in</span><span className="pk-tag">Version {p.version}</span><span className="pk-tag">by {p.author}</span></div>
  </div></div>
);
const Source = ({ p }: { p: DeptPage | AgentPage }) => (
  <div className="card pm-side"><div className="pm-kv"><span>Source</span><span>Built into OPERATOR, checked on every release</span><span>License</span><span>{p.license}</span></div></div>
);

export default async function PackPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, me] = await Promise.all([params, requireSession()]);
  const p = await packPageData(String(id).slice(0, 40));
  if (!p) notFound();
  const owner = atLeast(me.role, "owner");
  return (
    <div className="dp pm">
      <span className="pm-crumb"><Link href="/">Company</Link> › <Link href={packsHref()}>Packs</Link> › {p.name}</span>
      <div className="pm-dt">
        <div className="pm-main">
          <Hero p={p} />
          {p.kind === "department" ? <>
            <span className="pk-h6">Agents</span>
            <div className="pk-list">
              {p.agents.map((a) => <div key={a.name} className="pk-li"><span className="t"><b>{a.name}</b>, {a.role}<small>{a.sub}</small></span><span className="pk-off">Off duty</span></div>)}
              {p.seats.map((r) => <div key={r.title} className="pk-li"><span className="t"><b>{r.title}</b>, open seat<small>Fill it later from an agent pack, or ask the head to hire</small></span></div>)}
            </div>
            <span className="pk-h6">Its Overview page</span>
            {p.cells ? <div className="card pm-mini">{p.cells.flat().map((c, i) => <div key={i} className={`s${c.span}${c.big ? " tall" : ""}`}>{c.name}</div>)}</div>
              : <div className="pk-box">The usual department Overview: the report, runs and spend.</div>}
            {(p.chains.length > 0 || p.goals.length > 0) && <><span className="pk-h6">Chains and goals</span><div className="pk-list"><Rows rows={[...p.chains, ...p.goals]} /></div></>}
            <Conns conns={p.conns} />
          </> : <>
            <span className="pk-h6">The agent</span>
            <div className="pk-list"><div className="pk-li"><span className="t"><b>{p.agent.name}</b>, {p.agent.role}<small>{p.agent.sub}</small></span><span className="pk-off">Off duty</span></div></div>
            {p.suggests.length > 0 && <><span className="pk-h6">Can ask for (all start off)</span><div className="pk-list">{p.suggests.map((x) => (
              <div key={x} className="pk-li"><span className="t"><b>{x}</b><small>You turn it on when you add it, or later on its sheet. Each one is a draft for your OK.</small></span></div>
            ))}</div></>}
            <Conns conns={p.conns} />
          </>}
        </div>
        <div className="pm-aside">
          <div className="card pm-side">
            <span className="pk-h6">Once it’s on duty</span>
            <div className="pm-cost">{costWords(p.cost)}</div>
            <span className="pm-note">{costNote(p.cost, p.kind === "department" ? p.costWho : p.agent.name)}</span>
            {p.cant && <div className="pk-box warn">{p.cant}</div>}
            {p.kind === "department" && !p.cant && <>
              {p.have && <div className="pk-box">{p.have}</div>}
              {owner ? <AddPackButton id={p.id} name={p.name} install={installDeptPack} /> : <span className="pm-note">Only the owner can add a pack.</span>}
            </>}
            {p.kind === "agent" && !p.cant && <>
              <span className="pk-h6">Open seats it fits</span>
              {p.fits.length ? <div className="pk-list">{p.fits.map((x) => (
                <div key={x.seatId} className="pk-li"><span className="t"><b>{x.title}</b><small>{x.dept}{x.head ? `, under ${x.head}` : ""}</small></span>{owner && <Link href={fillHref(x.deptId, x.seatId, p.id)} scroll={false} className="dp-btn dark">Fill</Link>}</div>
              ))}</div> : <span className="pm-note">No open seat fits yet. Add a seat to a department, or ask a head to hire.</span>}
              {p.fits.length > 0 && <span className="pm-note">{owner ? "Fill opens the seat’s sheet with this pack picked, where you choose what it can do." : "Only the owner can fill a seat from a pack."}</span>}
            </>}
          </div>
          <Source p={p} />
        </div>
      </div>
    </div>
  );
}
