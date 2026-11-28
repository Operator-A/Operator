import "server-only";
// The pack installer (docs/packs.md). A new org starts empty, or from picked department
// packs: departments, the org chart, agents with their specs, playbooks, the chains and starting
// goals. Everything it installs is switched off (core/install-rules.ts): no agent runs until the
// owner approves its playbook, puts it on duty and turns the org on. Policies aren't installed:
// every cap and setting starts at its default in code.
import { db, createOrgRow } from "@/core/db";
import { withOrg } from "@/core/tenancy";
import { normalEmail } from "@/core/roles";
import { installRows, ontoSetup, type InstallRows } from "@/core/install-rules";
import { SETUP_AGENT, SETUP_TEMPLATE } from "@/core/setup-rules";
import { mergePacks } from "@/core/pack-rules";
import { pickPacks } from "@/core/packs";

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const ORDER: (keyof InstallRows)[] = ["departments", "agents", "agent_defs", "agent_playbooks", "seats", "crew_flow", "goals"];

/**
 * Installs the picked department packs into the current org. Refuses an org that already has a crew, except
 * one that setup started (card 151): it holds only the Chief of Staff, and the departments go in beside her.
 */
export async function installPacks(ids: readonly string[]): Promise<{ counts: Record<string, number> }> {
  let picked = pickPacks(ids);
  const [agents, depts] = await Promise.all([db().from("agents").select("id"), db().from("departments").select("id", { count: "exact", head: true })]);
  if (agents.error || depts.error) throw new Error((agents.error ?? depts.error)!.message);
  const have = (agents.data ?? []).map((a) => String(a.id));
  const onto = have.length > 0 && !depts.count && have.every((id) => id === SETUP_AGENT);
  if ((have.length && !onto) || depts.count) throw new Error("This org already has a crew: department packs install only into an empty org, or beside the Chief of Staff that setup installed.");
  if (!onto) {
    const { count, error } = await db().from("seats").select("org_id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    if (count) throw new Error("This org already has seats: department packs install only into an empty org.");
  }
  let flowVersion = 0;
  if (onto) {
    picked = [...pickPacks([SETUP_TEMPLATE]), ...picked.filter((t) => t.id !== SETUP_TEMPLATE)];
    const { data, error } = await db().from("crew_flow").select("version").order("version", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    flowVersion = Number(data?.version ?? 0);
  }
  const from = picked.map((t) => t.id).join("+");
  const all = installRows(from, mergePacks(picked));
  const rows = onto ? ontoSetup(all, { agent: SETUP_AGENT, flowVersion }) : all;
  // the merged chains replace the Chief of Staff's own: the old version stays as history, switched off
  if (onto && flowVersion) {
    const { error } = await db().from("crew_flow").update({ active: false }).eq("active", true);
    if (error) throw new Error(error.message);
  }
  const counts: Record<string, number> = {};
  for (const t of ORDER) {
    if (!rows[t].length) continue;
    let { error } = await db().from(t).insert(rows[t]);
    // before the widget grid migration (packs slice 2) departments have no overview or pack column: install without them
    if (error && t === "departments" && /overview|pack/.test(error.message)) {
      const bare = rows[t].map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "overview" && k !== "pack")));
      ({ error } = await db().from(t).insert(bare));
    }
    if (error) throw new Error(`Installing stopped at ${t} (${error.message}). Done before it: ${Object.keys(counts).join(", ") || "nothing"}.`);
    counts[t] = rows[t].length;
  }
  return { counts };
}

/**
 * A new org with its first owner, empty or from picked department packs. Run by whoever runs the app
 * (npm run org:new).
 */
export async function newOrg(p: { slug: string; name: string; ownerEmail: string; packs?: readonly string[] }): Promise<{ orgId: string; counts: Record<string, number> }> {
  const slug = p.slug.trim().toLowerCase(), name = p.name.trim(), email = normalEmail(p.ownerEmail);
  if (!SLUG.test(slug)) throw new Error("The slug is 2 to 41 lowercase letters, digits or dashes.");
  if (!name || name.length > 120) throw new Error("The name is 1 to 120 characters.");
  if (!email) throw new Error("The owner's email isn't an email address.");
  if (p.packs?.length) pickPacks(p.packs);
  const orgId = await createOrgRow(slug, name);
  return withOrg(orgId, async () => {
    const m = await db().from("members").insert({ email, role: "owner", added_by: "org:new" });
    if (m.error) throw new Error(`The org ${slug} was made but its owner wasn't added: ${m.error.message}`);
    const counts = p.packs?.length ? (await installPacks(p.packs)).counts : {};
    return { orgId, counts };
  });
}
