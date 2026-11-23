// Settings > General (docs/settings.md): time zone, theme, who is signed in; then how this OPERATOR runs.
import Link from "next/link";
import { cookies } from "next/headers";
import { SignOutButton } from "@/dashboard/components/signOut";
import { getOrgSwitch, requireSession } from "@/dashboard/data";
import { dbLock } from "@/core/db";
import { ROLE_LABELS, ROLE_WORDS } from "@/core/roles";
import { controlsOn } from "@/dashboard/session";
import { ThemeToggle } from "@/dashboard/components/client";
import { TimeZoneForm } from "@/dashboard/components/settingsForms";
import { SectionHead } from "@/dashboard/components/settingsHead";
import { saveTimeZone } from "@/dashboard/orgActions";
import { DEFAULT_TZ } from "@/core/time";
import { settings } from "@/core/settings";
import { NO_SETTINGS } from "@/core/settings-rules";

const onOff = (on: boolean) => <span className="pill sm" style={on ? { background: "var(--mint-soft)", color: "var(--mint-ink)" } : { background: "var(--soft)", color: "var(--ink2)" }}>{on ? "On" : "Off"}</span>;

/** A label (with a short line under it) on the left, its control on the right; stacks on a phone. */
const line = (k: React.ReactNode, v: React.ReactNode, first?: boolean) => (
  <div className={"set-row" + (first ? "" : " rule")}><span className="set-row-k">{k}</span>{v}</div>
);

export default async function General() {
  const [orgSwitch, me, own, jar] = await Promise.all([getOrgSwitch(), requireSession(), settings().catch(() => NO_SETTINGS), cookies()]);
  const theme = jar.get("cr_theme")?.value === "dark" ? "dark" : "light";
  const lock = dbLock();
  return (
    <>
      <SectionHead title="General" sub="How this OPERATOR looks and runs for you." />
      <div className="card set-card">
        {line(<>Time zone<span className="muted set-hint">Every time shown here, today’s email and spend limits, and when schedules start.</span></>, <TimeZoneForm initial={own.timeZone ?? DEFAULT_TZ} canEdit={me.role === "owner"} save={saveTimeZone} />, true)}
        {line("Theme", <ThemeToggle initial={theme} wide />)}
        {line(<>Signed in as <span style={{ overflowWrap: "anywhere" }}>{me.email}</span><span className="muted set-hint">{ROLE_LABELS[me.role]}: {ROLE_WORDS[me.role]}</span></>, <SignOutButton look="button" />)}
      </div>
      <span className="set-group">How it runs</span>
      <div className="card set-card">
        {line(<>The org<span className="muted set-hint">Turn every agent on or off at once on Crew &gt; Schedule.</span></>, <Link href="/crew?view=schedule" className="btn ghost sm">{orgSwitch.on ? "On" : "Off"} · Open</Link>, true)}
        {line(<>Controls<span className="muted set-hint">Real runs, putting agents back on the crew and raising budgets. Whoever runs this OPERATOR turns them on.</span></>, onOff(controlsOn()))}
        {line(<>Database lock<span className="muted set-hint">{lock.on ? "The database itself only lets this business’s rows through, on top of the app’s own checks." : lock.problem ?? "Off: the app’s own checks keep each business to its rows. Turn on with SUPABASE_SIGNING_KEY and SUPABASE_PUBLISHABLE_KEY in Vercel (docs/tenancy.md, slice 2b)."}</span></>, onOff(lock.on))}
      </div>
    </>
  );
}
