// Who may go on duty (card 188, docs/setup.md): an agent goes on duty only with an approved
// playbook, one agent at a time. The first job approves the first one; every other agent is put
// on duty from its own page once its playbook is approved. Pure, so check:on-duty can test it.

/** Why `name` can't go on duty, or null when it can. Unreadable playbooks count as none. */
export function onDutyProblem(name: string, playbooks: readonly { status: string }[] | null): string | null {
  if (!playbooks) return `${name}'s playbooks can't be read right now, so it stays off duty. Try again in a minute.`;
  if (!playbooks.some((p) => p.status === "approved")) return `${name} has no approved playbook yet. Approve its playbook on its page first, then put it on duty.`;
  return null;
}
