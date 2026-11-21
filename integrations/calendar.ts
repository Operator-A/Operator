import "server-only";
// Google Calendar, reads (card 251, docs/mcp-everywhere.md). Calls our own Calendar server through
// integrations/mcp.ts on the "Google Calendar" sign-in, granted calendar.events.readonly alone. The one
// write, a private hold, is the gateway's (core/gateway, "Calendar holds" sign-in), never called here.
import { callMcpTool } from "./mcp";
import type { CalEvent, Slot } from "@/core/calendar-rules";

export type Week = { time_zone: string; events: (CalEvent & { start_local?: string })[]; totals: { meetings: number; meeting_hours: number; with_guests: number }; busiest_day: { day: string; hours: number } | null };

export const calendarWeek = async (days: number) => (await callMcpTool("calendar", "calendar_events", { days })) as Week;

export const calendarFree = async (days: number, fromHour: number, toHour: number) =>
  (await callMcpTool("calendar", "calendar_free", { days, from_hour: fromHour, to_hour: toHour })) as { time_zone: string; slots: Slot[]; max_slots: number };
