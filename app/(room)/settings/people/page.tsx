// Settings > People (docs/settings.md, docs/tenancy.md slice 2): everyone who can sign in, and their role.
import { getTz, requireSession } from "@/dashboard/data";
import { listMembers } from "@/core/members";
import { People } from "@/dashboard/components/people";
import { SectionHead } from "@/dashboard/components/settingsHead";
import { peopleAdd, peopleRemove, peopleSetRole } from "@/dashboard/peopleActions";

export default async function PeoplePage() {
  const [tz, me, members] = await Promise.all([getTz(), requireSession(), listMembers().catch(() => null)]);
  return (
    <>
      <SectionHead title="People" sub="Everyone who can sign in, and what they can do. Each person signs in with a link emailed to them." />
      <div className="card set-card pad">
        <span className="sub">Viewers see every page; approvers also decide cards, teach agents and stop things; owners can do everything. At least one owner always remains.</span>
        {members == null ? <span className="sub">The people migration (20261203090000_members.sql) isn’t applied yet.</span> : (
          <People
            people={members.map((m) => ({ id: m.id, email: m.email, role: m.role, you: m.id === me.id, lastSignIn: m.last_sign_in_at }))}
            tz={tz} canEdit={me.role === "owner"} add={peopleAdd} setRole={peopleSetRole} remove={peopleRemove}
          />
        )}
      </div>
    </>
  );
}
