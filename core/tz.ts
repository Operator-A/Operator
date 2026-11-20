import "server-only";
// The current business's time zone (card 187): the one its owner picked on Settings, or set from the
// browser on setup's first step; DEFAULT_TZ when it never set one. Calendar days (today's caps, this
// month's spend), chain start times and every time on screen use it.
import { settings } from "@/core/settings";
import { DEFAULT_TZ, localDate } from "@/core/time";

export async function orgTz(): Promise<string> {
  return (await settings().catch(() => null))?.timeZone ?? DEFAULT_TZ;
}

/** "2026-10-27" for the calendar day `daysAgo` before now, in the business's time zone. */
export async function orgDate(daysAgo = 0, now = new Date()): Promise<string> {
  return localDate(await orgTz(), daysAgo, now);
}
