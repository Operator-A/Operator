// Control Room sessions: the cookie itself lives in core/session.ts (core/request-org.ts reads it
// to learn a request's org). Re-exported here for the pages and actions.
export { SESSION_COOKIE, SESSION_DAYS, loginConfigured, newSessionToken, sessionCookieOptions, sessionMemberId, sessionOf, validSessionToken } from "@/core/session";

/**
 * Controls that can spend money or wake an agent (real runs, back on the crew, budget changes). The cloud
 * edition has them on unless DASHBOARD_CONTROLS says off (Nov 20: a cloud founder can't set an env var,
 * and budgets, caps and approval cards still hold every run); self-host keeps them off until it says on.
 */
export const controlsOn = () => controlsFrom(process.env.DASHBOARD_CONTROLS, process.env.OPERATOR_EDITION);
export function controlsFrom(raw: string | undefined, edition: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (["on", "1", "true"].includes(v)) return true;
  if (["off", "0", "false"].includes(v)) return false;
  return (edition ?? "").trim().toLowerCase() === "cloud";
}
