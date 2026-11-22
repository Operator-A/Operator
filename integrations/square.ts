import "server-only";
// Square, reads (card 242, docs/mcp-everywhere.md "Square"). Calls our own Square server through
// integrations/mcp.ts on the business's Square sign-in. Each call runs fixed requests and the totals
// come back worked out in code (core/square-rules.ts).
import { callMcpTool } from "./mcp";
import type { Appointments, Location, OpenInvoice, Payments } from "@/core/square-rules";

export const squarePayments = async (days: number) => (await callMcpTool("square", "square_payments", { days })) as Payments;
export const squareLocations = async () => (await callMcpTool("square", "square_locations", {})) as { locations: Location[] };
export const squareOpenInvoices = async (limit: number) =>
  (await callMcpTool("square", "square_open_invoices", { limit })) as { invoices: OpenInvoice[]; open: number; overdue: number; overdue_amount: Record<string, number>; locations_searched: number };
export const squareAppointments = async (days: number, when: "past" | "next") => (await callMcpTool("square", "square_appointments", { days, when })) as Appointments;
export const squareCustomers = async (limit: number) => (await callMcpTool("square", "square_customers", { limit })) as { customers: { id: string; label: string }[] };
