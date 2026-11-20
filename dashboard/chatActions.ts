"use server";
// Avery's chat (docs/company-mode.md, slice 5). Checks the login again. A message makes real model
// calls, so it also needs DASHBOARD_CONTROLS=on. Avery can only answer, save a rule in the owner's words
// and file a proposal; see core/avery-chat.ts.
import { revalidatePath } from "next/cache";
import { askAvery, type ChatAnswer } from "@/core/avery-chat";
import { cleanMessage } from "@/core/chat-rules";
import { asRole } from "./data";
import { withActor } from "@/core/actor";
import { controlsOn } from "./session";

export async function sendToAvery(raw: string): Promise<ChatAnswer> {
  const none = (reply: string): ChatAnswer => ({ ok: false, reply, notes: [], runId: null, costUsd: 0, kept: false });
  const { me, no } = await asRole("approver");
  if (no) return none(no.text);
  if (!controlsOn()) return none("Real runs are switched off on this OPERATOR, so I can’t answer: each message is a real model call. Whoever runs it can turn them on.");
  const m = cleanMessage(raw);
  if ("problem" in m) return none(m.problem);
  try {
    const a = await withActor(me.email, () => askAvery(m.text));
    revalidatePath("/", "layout");
    return a;
  } catch (e) { return none(`Something went wrong: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`); }
}
