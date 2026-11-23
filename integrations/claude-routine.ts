import "server-only";
// Agents that run in Claude (docs/live-events.md, slice 2): the only file that calls Anthropic's routine
// fire endpoint. Reached only through integrations/mcp.ts (fireRoutine), which opens the routine's token
// from the vault, decides retries (core/routine-rules.ts afterFire) and pauses a refused token. One POST,
// never a redirect followed, the token only in the Authorization header and never in an error.
import { ROUTINE_API, readSession } from "@/core/routine-rules";

export interface FireAnswer { status: number; retryAfter: string | null; session: { id: string; url: string } | null }

/** Fires one routine with OPERATOR's note. Throws only when the request couldn't be sent or answered in time. */
export async function postFire(routine: string, token: string, text: string): Promise<FireAnswer> {
  const res = await fetch(`${ROUTINE_API.base}${encodeURIComponent(routine)}/fire`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "anthropic-version": ROUTINE_API.version,
      "anthropic-beta": ROUTINE_API.beta,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: text.slice(0, ROUTINE_API.maxText) }),
    redirect: "error",
    signal: AbortSignal.timeout(ROUTINE_API.timeoutMs),
  });
  const body = res.ok ? await res.json().catch(() => null) : null;
  return { status: res.status, retryAfter: res.headers.get("retry-after"), session: res.ok ? readSession(body) : null };
}
