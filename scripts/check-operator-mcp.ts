// OPERATOR's own MCP server (docs/operator-mcp.md): `npm run check:operator-mcp`. Pure: no network, no
// database. Tests the tool list, the JSON-RPC answers, the sign-in rules (registration, PKCE, tokens) and
// reads the source for the rules that keep the server to reads and to one business.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONSENT_NEVER, LIMITS, MCP_PATH, OP_TOOLS, PROTOCOL_VERSIONS, answerText, authServerMetadata, bearerOf, challenge, checkArgs, clientIdOf, clientOf, dispatch,
  hashSecret, hashesMatch, isResponse, newToken, nextWindow, originOf, pickProtocol, pkceOk, readAuthorize, readRegistration, readRpc, redirectAllowed, redirectOk,
  resourceMetadata, toolsFor, tokenParts, TOOL_BY_NAME, type RpcRequest,
} from "../core/operator-mcp-rules";
import { TENANT_TABLES } from "../core/tenancy";

const read = (p: string) => readFileSync(p, "utf8");
const SECRET = "s".repeat(40);
const ORIGIN = "https://op.example.com";
const ORG = "0e1a7c4e-0002-4000-8000-000000000002", GRANT = "0e1a7c4e-00aa-4000-8000-0000000000aa";

const run = async () => {
  // ---- the tool list: slice 1 is reads only, every member is offered all of them
  assert.deepEqual(OP_TOOLS.map((t) => t.name), ["get_company", "list_agents", "get_agent", "list_runs", "list_waiting", "list_tools", "list_brains"]);
  assert.ok(OP_TOOLS.every((t) => t.kind === "read" && t.min === "viewer"), "slice 1: read tools, any member");
  assert.equal(toolsFor("viewer").length, OP_TOOLS.length);
  for (const t of OP_TOOLS) assert.equal(t.inputSchema.additionalProperties, false, `${t.name} takes only the arguments it names`);
  const banned = /approve|reject|go_live|golive|enable|grant|cap|budget|delete|remove|connect|schedule|turn_on|run_now|send/;
  assert.ok(OP_TOOLS.every((t) => !banned.test(t.name)), "no tool approves, puts on duty, grants, changes caps or deletes");

  // ---- arguments: known keys only, capped
  const agent = TOOL_BY_NAME.get_agent, runs = TOOL_BY_NAME.list_runs;
  assert.deepEqual(checkArgs(agent, { agent: "  Morgan  " }), { args: { agent: "Morgan" } });
  assert.match((checkArgs(agent, {}) as { problem: string }).problem, /needs agent/);
  assert.match((checkArgs(agent, { agent: "x", sql: "drop" }) as { problem: string }).problem, /no argument "sql"/);
  assert.match((checkArgs(agent, { agent: "x".repeat(81) }) as { problem: string }).problem, /longer than 80/);
  assert.match((checkArgs(agent, { agent: 5 }) as { problem: string }).problem, /must be text/);
  assert.match((checkArgs(runs, { limit: 50 }) as { problem: string }).problem, /from 1 to 20/);
  assert.deepEqual(checkArgs(runs, { limit: 3 }), { args: { limit: 3 } });
  assert.match((checkArgs(runs, ["x"]) as { problem: string }).problem, /must be an object/);

  // ---- answers are scrubbed and cut
  const leaked = answerText({ note: "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 here" }, `${ORIGIN}/crew`);
  assert.ok(!leaked.includes("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"), "a secret-looking value never reaches Claude");
  assert.match(leaked, /Open in OPERATOR: https:\/\/op\.example\.com\/crew$/);
  assert.match(answerText("x".repeat(LIMITS.answerChars + 50), null), /cut at 24000 characters/);

  // ---- JSON-RPC
  assert.equal(pickProtocol("2025-06-18"), "2025-06-18");
  assert.equal(pickProtocol("1999-01-01"), PROTOCOL_VERSIONS[0]);
  assert.ok(isResponse(readRpc([{ jsonrpc: "2.0", id: 1, method: "ping" }])), "batches are refused");
  assert.ok(isResponse(readRpc({ id: 1, method: "ping" })), "jsonrpc 2.0 only");
  const req = (method: string, params?: Record<string, unknown>, id: number | "none" = 1) => readRpc(id === "none" ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }) as RpcRequest;
  const calls: string[] = [];
  const call = async (t: { name: string }, a: Record<string, string | number>) => { calls.push(`${t.name}:${JSON.stringify(a)}`); if (t.name === "list_tools") throw new Error("boom token=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"); return { text: "ok" }; };
  const init = await dispatch(req("initialize", { protocolVersion: "2025-06-18" }), "viewer", call);
  assert.equal((init!.result as { protocolVersion: string }).protocolVersion, "2025-06-18");
  assert.match(JSON.stringify(init!.result), /source of truth/);
  assert.equal(await dispatch(req("notifications/initialized", {}, "none"), "viewer", call), null, "a notification gets no answer");
  const list = await dispatch(req("tools/list"), "viewer", call);
  assert.equal((list!.result as { tools: unknown[] }).tools.length, OP_TOOLS.length);
  assert.ok((list!.result as { tools: { annotations: { readOnlyHint: boolean } }[] }).tools.every((t) => t.annotations.readOnlyHint));
  const got = await dispatch(req("tools/call", { name: "get_agent", arguments: { agent: "cfo" } }), "viewer", call);
  assert.deepEqual(got!.result, { isError: false, content: [{ type: "text", text: "ok" }] });
  assert.deepEqual(calls, ['get_agent:{"agent":"cfo"}']);
  const bad = await dispatch(req("tools/call", { name: "get_agent", arguments: {} }), "viewer", call);
  assert.equal((bad!.result as { isError: boolean }).isError, true);
  assert.equal(calls.length, 1, "a call with bad arguments never reaches the tool");
  assert.equal((await dispatch(req("tools/call", { name: "approve_card" }), "owner", call))!.error!.code, -32602, "a tool not on the list does nothing");
  const boom = await dispatch(req("tools/call", { name: "list_tools" }), "viewer", call);
  assert.ok(!JSON.stringify(boom).includes("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"), "errors are scrubbed");
  assert.equal((await dispatch(req("resources/list"), "owner", call))!.error!.code, -32601);

  // ---- sign-in metadata
  assert.equal(resourceMetadata(ORIGIN).resource, `${ORIGIN}${MCP_PATH}`);
  assert.deepEqual(resourceMetadata(ORIGIN).authorization_servers, [ORIGIN]);
  const as = authServerMetadata(ORIGIN);
  assert.equal(as.issuer, ORIGIN);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"], "PKCE S256 only");
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal(as.authorization_endpoint, `${ORIGIN}/oauth/authorize`);
  assert.match(challenge(ORIGIN), /resource_metadata="https:\/\/op\.example\.com\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  assert.match(challenge(ORIGIN, "invalid_token"), /error="invalid_token"/);

  // ---- registration: nothing stored, the client id is signed
  assert.equal(redirectOk("https://claude.ai/api/mcp/auth_callback"), "https://claude.ai/api/mcp/auth_callback");
  assert.equal(redirectOk("http://localhost:6274/cb"), "http://localhost:6274/cb");
  for (const b of ["http://evil.example/cb", "https://x.example/cb#frag", "https://u:p@x.example/cb", "javascript:alert(1)", "", "https://x.example/" + "a".repeat(500)]) assert.equal(redirectOk(b), null, b.slice(0, 40));
  const reg = readRegistration({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" });
  assert.ok("client" in reg);
  assert.match((readRegistration({ redirect_uris: [] }) as { problem: string }).problem, /at least one/);
  assert.match((readRegistration({ redirect_uris: ["http://evil.example/cb"] }) as { problem: string }).problem, /https/);
  assert.match((readRegistration({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_basic" }) as { problem: string }).problem, /none/);
  assert.match((readRegistration({ redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] }) as { problem: string }).problem, /grant_types/);
  assert.match((readRegistration({ redirect_uris: Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`) }) as { problem: string }).problem, /at most 5/);
  assert.equal((readRegistration({ client_name: "<b>x</b>", redirect_uris: ["https://a.example/cb"] }) as { client: { name: string } }).client.name, "bx/b", "names lose angle brackets");
  const client = (reg as { client: { name: string; redirectUris: string[] } }).client;
  const id = clientIdOf(client, SECRET);
  assert.deepEqual(clientOf(id, SECRET), client);
  assert.equal(clientOf(id, "t".repeat(40)), null, "another deployment's secret fails");
  assert.equal(clientOf(id, "short"), null);
  const [v, payload, mac] = id.split(".");
  const forged = Buffer.from(JSON.stringify({ n: "Claude", r: ["https://evil.example/cb"] })).toString("base64url");
  assert.equal(clientOf(`${v}.${forged}.${mac}`, SECRET), null, "a changed redirect fails the signature");
  assert.ok(payload && redirectAllowed(client, "https://claude.ai/api/mcp/auth_callback") && !redirectAllowed(client, "https://claude.ai/other"));

  // ---- the authorize request
  const challengeOf = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"; // RFC 7636 appendix B
  const q = { client_id: id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", response_type: "code", code_challenge: challengeOf, code_challenge_method: "S256", state: "xyz", resource: `${ORIGIN}/api/mcp` };
  const ok = readAuthorize(q, SECRET, ORIGIN);
  assert.ok("ask" in ok && ok.ask.state === "xyz" && ok.ask.client.name === "Claude");
  const noClient = readAuthorize({ ...q, client_id: "nope" }, SECRET, ORIGIN) as { problem: string; redirect?: string };
  assert.ok(noClient.problem && !noClient.redirect, "an unknown app is never redirected to");
  const elsewhere = readAuthorize({ ...q, redirect_uri: "https://evil.example/cb" }, SECRET, ORIGIN) as { problem: string; redirect?: string };
  assert.ok(elsewhere.problem && !elsewhere.redirect, "an address the app didn't register is never redirected to");
  const plain = readAuthorize({ ...q, code_challenge_method: "plain" }, SECRET, ORIGIN) as { redirect: string };
  assert.match(plain.redirect, /error=invalid_request&state=xyz/);
  assert.match((readAuthorize({ ...q, response_type: "token" }, SECRET, ORIGIN) as { redirect: string }).redirect, /unsupported_response_type/);
  assert.match((readAuthorize({ ...q, resource: "https://other.example/mcp" }, SECRET, ORIGIN) as { redirect: string }).redirect, /invalid_target/);
  assert.ok("ask" in readAuthorize({ ...q, resource: undefined }, SECRET, ORIGIN), "resource is optional");

  // ---- PKCE
  assert.ok(pkceOk("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", challengeOf));
  assert.ok(!pkceOk("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXX", challengeOf));
  assert.ok(!pkceOk("short", challengeOf) && !pkceOk(undefined, challengeOf));

  // ---- tokens: name the org and grant, only the hash is kept
  const a = newToken("a", ORG, GRANT);
  const p = tokenParts(a.token, "a")!;
  assert.deepEqual([p.orgId, p.grantId], [ORG, GRANT]);
  assert.ok(hashesMatch(a.hash, p.hash) && a.hash.length === 64 && !a.token.includes(a.hash));
  assert.equal(tokenParts(a.token, "r"), null, "an access token isn't a refresh token");
  assert.equal(tokenParts(a.token.replace(ORG, "0e1a7c4e-0001-4000-8000-000000000001"), "a")!.hash, p.hash, "the org in a token only says where to look");
  assert.ok(!hashesMatch(newToken("a", ORG, GRANT).hash, p.hash), "every token is new");
  assert.equal(tokenParts(`${a.token}x`, "a"), null);
  assert.ok(!hashesMatch(null, p.hash) && hashSecret("a") !== hashSecret("b"));
  assert.throws(() => newToken("a", "home", GRANT), /org and a grant/);
  assert.equal(bearerOf(`Bearer ${a.token}`), a.token);
  assert.equal(bearerOf("Basic abc"), null);

  // ---- 60 calls a minute
  const t0 = Date.parse("2026-11-23T12:00:00Z");
  let w = nextWindow(null, 0, t0);
  for (let i = 1; i < LIMITS.callsPerMinute; i++) w = nextWindow(w.start, w.calls, t0 + i * 100);
  assert.ok(w.ok && w.calls === 60);
  assert.equal(nextWindow(w.start, w.calls, t0 + 59_000).ok, false, "the 61st call in a minute waits");
  assert.deepEqual(nextWindow(w.start, w.calls, t0 + 60_000), { start: new Date(t0 + 60_000).toISOString(), calls: 1, ok: true });

  assert.equal(originOf("http://internal:3000/api/mcp", "op.example.com", "https"), ORIGIN);
  assert.equal(originOf("https://op.example.com/x", null, null), ORIGIN);
  assert.match(CONSENT_NEVER, /can't approve cards, put an agent on duty/);

  // ---- the source: one business per call, reads only, the sign-in addresses reachable
  const store = read("core/operator-mcp.ts");
  for (const w of ["saveSpecVersion", "createBuiltAgent", "activateSpecVersion", "fileProposal", "acceptProposal", "callWriteTool", "@/core/gateway", "withRun"]) assert.ok(!store.includes(w), `slice 1 reads only: core/operator-mcp.ts doesn't use ${w}`);
  const writes = [...store.matchAll(/from\("(\w+)"\)\.(insert|update|upsert|delete)\(/g)].map((m) => m[1]);
  assert.ok(writes.length >= 4 && writes.every((t) => t === "mcp_grants"), `the server writes only its own grants (saw ${writes.join(", ")})`);
  for (const t of OP_TOOLS) assert.match(store, new RegExp(`case "${t.name}":`), `runTool runs ${t.name}`);
  assert.match(store, /return withOrg\(caller\.orgId, \(\) => \{/, "tools run inside the caller's business");
  assert.match(store, /const m = await memberById\(g\.member_id\);/, "the member is read again on every call");
  const route = read("app/api/mcp/route.ts");
  assert.ok(route.indexOf("verifyAccess(") < route.indexOf("req.json()"), "the token is checked before the body is read");
  assert.match(route, /export const GET = notOffered;/);
  assert.match(read("proxy.ts"), /\\\\\.well-known\//, "the sign-in metadata isn't behind the Control Room sign-in");
  assert.match(read("next.config.ts"), /\/\.well-known\/oauth-protected-resource\/:path\*/);
  assert.match(read("next.config.ts"), /\/\.well-known\/oauth-authorization-server/);
  const sql = read("supabase/migrations/20270103090000_mcp_grants.sql");
  assert.match(sql, /org_id uuid not null references orgs\(id\)/);
  assert.match(sql, /member_id uuid not null references members\(id\) on delete cascade/);
  assert.match(sql, /create policy org_rows on mcp_grants/);
  assert.ok(!/\b(access_token|refresh_token|code) text\b/.test(sql), "no token is stored, only hashes");
  assert.ok((TENANT_TABLES as readonly string[]).includes("mcp_grants"));
  assert.match(read("app/oauth/authorize/page.tsx"), /requireSession\(\)/, "the consent page needs a signed-in member");
  assert.match(read("dashboard/mcpActions.ts"), /const r = readAuthorize\(q, clientSecret\(\), await selfOrigin\(\)\);/, "Allow checks the request again");
  assert.match(read("CLAUDE.md"), /OPERATOR's own MCP server/, "the hard rules name the server");

  console.log(`check:operator-mcp ok (${OP_TOOLS.length} read tools)`);
};
run().catch((e) => { console.error(e); process.exit(1); });
