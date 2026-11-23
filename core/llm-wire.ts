// The two wire shapes other providers speak (docs/agent-setup.md, "Models across providers", slice 3):
// the Responses API (OpenAI and xAI, POST /v1/responses; function tools on current OpenAI models work
// only there) and OpenAI-style chat completions (Google's OpenAI-compatible endpoint). Pure translation
// between them and the Claude Messages shape the runner keeps (integrations/llm.ts), so it is tested
// without a network.
//
// What only Claude has is dropped on the way out: thinking blocks, server tools (web search and fetch
// run on Claude's side) and cache markers. The runner never offers server tools to these models.

/** The Claude-shaped request the runner sends (a structural subset of the SDK types, so this file needs no SDK). */
export interface ClaudeTurn {
  model: string;
  maxOut: number;
  effort: "low" | "medium" | "high";
  system: readonly { type: "text"; text: string }[];
  tools: readonly unknown[];
  messages: readonly { role: "user" | "assistant"; content: string | readonly unknown[] }[];
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: { type: "function"; function: { name: string; description: string; parameters: unknown } }[];
  reasoning_effort: "low" | "medium" | "high";
  max_tokens: number;
}

export interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null; tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null };
}

/** A reply back in the Claude shape: content blocks, stop reason and usage counts. */
export interface ClaudeReply {
  content: ({ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> })[];
  stopReason: string;
  model: string | null;
  usage: { tokensIn: number; tokensOut: number; cacheWrite: number; cacheRead: number; searches: number };
}

type Block = { type?: string; text?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; content?: unknown; input_schema?: unknown; description?: unknown };

const textOf = (c: unknown): string => {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b: Block) => (b?.type === "text" && typeof b.text === "string" ? b.text : "")).filter(Boolean).join("\n");
  return "";
};

/** The runner's turn as an OpenAI-style chat request. */
export function toChat(t: ClaudeTurn): ChatRequest {
  const messages: ChatMessage[] = [];
  const sys = t.system.map((b) => b.text).filter(Boolean).join("\n\n");
  if (sys) messages.push({ role: "system", content: sys });
  for (const m of t.messages) {
    if (typeof m.content === "string") { messages.push(m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content }); continue; }
    const blocks = m.content as Block[];
    if (m.role === "assistant") {
      const text = blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("\n");
      const calls = blocks.filter((b) => b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string")
        .map((b) => ({ id: b.id as string, type: "function" as const, function: { name: b.name as string, arguments: JSON.stringify(b.input ?? {}) } }));
      if (!text && !calls.length) continue;
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // a user turn: tool results become tool messages, in order, then any text the runner added after them
    for (const b of blocks) if (b.type === "tool_result" && typeof b.tool_use_id === "string") messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: textOf(b.content) || "(no output)" });
    const text = blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("\n");
    if (text) messages.push({ role: "user", content: text });
  }
  const tools = (t.tools as Block[])
    .filter((x) => !x.type && typeof x.name === "string" && x.input_schema && typeof x.input_schema === "object")
    .map((x) => ({ type: "function" as const, function: { name: x.name as string, description: typeof x.description === "string" ? x.description : "", parameters: x.input_schema } }));
  return { model: t.model, messages, ...(tools.length ? { tools } : {}), reasoning_effort: t.effort, max_tokens: t.maxOut };
}

const STOP: Record<string, string> = { tool_calls: "tool_use", function_call: "tool_use", stop: "end_turn", length: "max_tokens", content_filter: "refusal" };
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** An OpenAI-style reply in the Claude shape. Tool arguments that aren't a JSON object come through as {}, so the runner's input check names the problem. */
export function fromChat(r: ChatResponse): ClaudeReply {
  const choice = r.choices?.[0];
  const msg = choice?.message ?? {};
  const content: ClaudeReply["content"] = [];
  const text = typeof msg.content === "string" ? msg.content.trim() : "";
  if (text) content.push({ type: "text", text });
  for (const [i, c] of (msg.tool_calls ?? []).entries()) {
    const name = c.function?.name;
    if (typeof name !== "string" || !name) continue;
    let input: Record<string, unknown> = {};
    try { const v = JSON.parse(c.function?.arguments || "{}"); if (v && typeof v === "object" && !Array.isArray(v)) input = v as Record<string, unknown>; } catch { /* left empty */ }
    content.push({ type: "tool_use", id: typeof c.id === "string" && c.id ? c.id : `call_${i}`, name, input });
  }
  const refused = typeof msg.refusal === "string" && msg.refusal.trim().length > 0;
  const stopReason = refused ? "refusal" : content.some((b) => b.type === "tool_use") ? "tool_use" : STOP[choice?.finish_reason ?? ""] ?? "end_turn";
  const tokensIn = n(r.usage?.prompt_tokens);
  const cacheRead = Math.min(tokensIn, n(r.usage?.prompt_tokens_details?.cached_tokens));
  return { content, stopReason, model: typeof r.model === "string" ? r.model : null, usage: { tokensIn, tokensOut: n(r.usage?.completion_tokens), cacheWrite: 0, cacheRead, searches: 0 } };
}

// ---- Responses API (OpenAI, xAI)

export type ResponsesItem =
  | { role: "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export interface ResponsesRequest {
  model: string;
  instructions?: string;
  input: ResponsesItem[];
  tools?: { type: "function"; name: string; description: string; parameters: unknown }[];
  reasoning: { effort: "low" | "medium" | "high" };
  max_output_tokens: number;
  /** Nothing is kept at the provider between turns: the runner re-sends the whole transcript, like on Claude. */
  store: false;
}

export interface ResponsesResponse {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: { type?: string; call_id?: string; name?: string; arguments?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } | null };
}

/** The runner's turn as a Responses API request. */
export function toResponses(t: ClaudeTurn): ResponsesRequest {
  const chat = toChat(t);
  const input: ResponsesItem[] = [];
  let instructions: string | undefined;
  for (const m of chat.messages) {
    if (m.role === "system") instructions = m.content;
    else if (m.role === "user") input.push({ role: "user", content: m.content });
    else if (m.role === "tool") input.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content });
    else {
      if (m.content) input.push({ role: "assistant", content: m.content });
      for (const c of m.tool_calls ?? []) input.push({ type: "function_call", call_id: c.id, name: c.function.name, arguments: c.function.arguments });
    }
  }
  const tools = chat.tools?.map((x) => ({ type: "function" as const, name: x.function.name, description: x.function.description, parameters: x.function.parameters }));
  return { model: t.model, ...(instructions ? { instructions } : {}), input, ...(tools?.length ? { tools } : {}), reasoning: { effort: t.effort }, max_output_tokens: t.maxOut, store: false };
}

/** A Responses API reply in the Claude shape. */
export function fromResponses(r: ResponsesResponse): ClaudeReply {
  const content: ClaudeReply["content"] = [];
  let refused = false;
  for (const [i, o] of (r.output ?? []).entries()) {
    if (o.type === "message") {
      const text = (o.content ?? []).map((c) => (c.type === "output_text" && typeof c.text === "string" ? c.text : "")).join("").trim();
      if ((o.content ?? []).some((c) => c.type === "refusal")) refused = true;
      if (text) content.push({ type: "text", text });
    } else if (o.type === "function_call" && typeof o.name === "string" && o.name) {
      let input: Record<string, unknown> = {};
      try { const v = JSON.parse(o.arguments || "{}"); if (v && typeof v === "object" && !Array.isArray(v)) input = v as Record<string, unknown>; } catch { /* left empty */ }
      content.push({ type: "tool_use", id: typeof o.call_id === "string" && o.call_id ? o.call_id : `call_${i}`, name: o.name, input });
    }
  }
  const why = r.incomplete_details?.reason;
  const stopReason = refused || why === "content_filter" ? "refusal"
    : content.some((b) => b.type === "tool_use") ? "tool_use"
    : r.status === "incomplete" && why === "max_output_tokens" ? "max_tokens" : "end_turn";
  const tokensIn = n(r.usage?.input_tokens);
  const cacheRead = Math.min(tokensIn, n(r.usage?.input_tokens_details?.cached_tokens));
  return { content, stopReason, model: typeof r.model === "string" ? r.model : null, usage: { tokensIn, tokensOut: n(r.usage?.output_tokens), cacheWrite: 0, cacheRead, searches: 0 } };
}
