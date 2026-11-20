// Klaviyo campaign drafts (card 159b, docs/mcp-everywhere.md "Klaviyo campaign drafts"). Pure, so
// `npm run check:mcp` and `npm run check:policy` can test it.
//
// The Campaign writer stages one campaign: a list, a subject, preview text and a plain body. After an
// approver approves, the gateway asks our own small server (integrations/klaviyo-drafts-server.ts) to
// create a template and a draft campaign in the business's Klaviyo. Nothing is sent or scheduled: the
// owner reviews the draft in Klaviyo and sends it there. The server has no send, schedule or delete code.

export const CAMPAIGN_LIMITS = { subject: 50, preview: 90, body: 3000 } as const;
/** Fields a campaign draft holds. The list is the action's target, read from the business's own Klaviyo by code. */
export const CAMPAIGN_FIELDS = ["subject", "preview", "body"] as const;
export interface CampaignArgs { subject: string; preview: string; body: string }

/** Klaviyo list ids are short letters and digits (for example "XZRviM"). */
export const listIdOk = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9]{4,40}$/.test(s);

/** Klaviyo private API keys start with pk_. */
export const looksLikeKlaviyoKey = (k: string) => /^pk_[A-Za-z0-9_]{20,120}$/.test(k.trim());

const LINK = /https?:\/\/|www\.|\{\{|\{%/i;

/** Why a campaign's words are refused: one-line subject and preview, plain body, no links, no template tags, no control characters. */
export function refuseCampaign(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => !(CAMPAIGN_FIELDS as readonly string[]).includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A campaign draft holds only a subject, preview text and a body; the list is picked from Email lists.`;
  const { subject, preview, body } = args as Partial<CampaignArgs>;
  if (typeof subject !== "string" || !subject.trim()) return "The campaign needs a subject.";
  if (subject.length > CAMPAIGN_LIMITS.subject) return `The subject is longer than ${CAMPAIGN_LIMITS.subject} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(subject)) return "The subject must be one line of plain text.";
  if (typeof preview !== "string" || !preview.trim()) return "The campaign needs preview text.";
  if (preview.length > CAMPAIGN_LIMITS.preview) return `The preview text is longer than ${CAMPAIGN_LIMITS.preview} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(preview)) return "The preview text must be one line of plain text.";
  if (typeof body !== "string" || !body.trim()) return "The campaign needs a body.";
  if (body.length > CAMPAIGN_LIMITS.body) return `The body is longer than ${CAMPAIGN_LIMITS.body} characters.`;
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(body)) return "The body may not hold control characters.";
  if (LINK.test(subject + preview + body)) return "A campaign may not hold links or template tags: a web page could have put them there.";
  return null;
}

/** What the server accepts for its one write tool, checked again there. */
export function checkDraftArgs(raw: unknown): { listId: string; subject: string; preview: string; body: string } | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!listIdOk(a.listId)) return { problem: "listId must be a Klaviyo list id" };
  const { listId, ...words } = a;
  const no = refuseCampaign(words);
  if (no) return { problem: no };
  return { listId: listId as string, subject: String(a.subject), preview: String(a.preview), body: String(a.body) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The template's HTML: the approved body, escaped, one paragraph per blank-line block, then Klaviyo's
 * own unsubscribe tag, which code adds (never the model) so every campaign carries a way out.
 */
export function campaignHtml(body: string): string {
  const paras = body.trim().split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`);
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5">${paras.join("")}<p style="font-size:12px;color:#777">{% unsubscribe 'Unsubscribe' %}</p></body></html>`;
}

/** The plain-text part: the body as approved, plus the unsubscribe tag. */
export const campaignText = (body: string) => `${body.trim()}\n\n{% unsubscribe_url %}`;

/** The draft's name in Klaviyo, so the owner can tell it came from an agent. */
export const campaignName = (subject: string, date: string) => `Draft from your Campaign writer · ${date} · ${subject}`.slice(0, 120);
