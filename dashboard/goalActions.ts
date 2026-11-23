"use server";
// Goal actions (docs/company-mode.md, slice 2). Each checks the login again. Setting and changing a goal is
// asked for in the department's chat since department pages slice 6 (a change card, core/proposals.ts);
// what stays here is ticking a job from a head's plan. Nothing here runs, sends or spends.
import { revalidatePath } from "next/cache";
import { setJobDone } from "@/core/plans";
import type { ActionResult } from "./actions";
import { asRole } from "./data";

const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/", "layout"); return { ok: true, text }; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A person's job from a head's plan (slice 4): the owner marks it done, or not done. */
export async function planJobDone(planId: string, n: number, isDone: boolean): Promise<ActionResult> {
  const { no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(String(planId)) || !Number.isInteger(n)) return { ok: false, text: "Unknown job." };
  try { await setJobDone(planId, n, isDone); return done(isDone ? "Marked done." : "Back on your list."); } catch (e) { return fail(e); }
}
