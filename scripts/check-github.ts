// GitHub, read only (engineering isolation slice 1, docs/engineering.md): the profile, the rules, our own
// server end to end on a fake GitHub, and the wiring. No network: GitHub is a fake `fetch` that records
// every request.
// Run: npm run check:github
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MCP_SERVERS, checkedTools, isAppSignIn, isGitHubApp, isHosted, mayCall, mayReport, mayWrite, usesConnect } from "../core/mcp-rules";
import {
  GITHUB_API, GITHUB_AUTH, GITHUB_TOOLS, MAX_ISSUES, MAX_PATHS, MAX_PRS, MAX_REPOS, NO_INSTALL, READ_PERMISSIONS, TOKEN_REUSE_MS, appClaims, checkGitHubArgs, checksOf, installUrl, installationFor,
  permissionProblem, prTotals, readInstallations, readIssues, readPaths, readPr, readRepoList, readRepos, repoOk, slugOk, toggleRepo, tokenRequestBody, writeRepos,
} from "../core/github-rules";
import { TOOLS as ACTIONS } from "../core/gateway/policy";
import { TOOL_LIST } from "../core/tools/catalog";
import { githubAppJwt, githubInstallations, githubRepoLines, githubRevokeUserToken, githubServer } from "../integrations/github-server";

const now = Date.parse("2026-11-28T12:00:00Z");
const day = 86_400_000;

// ---- the profile: read tools only, no write, no report, no gateway action type
const p = MCP_SERVERS.github;
assert.equal(p.auth, "github");
assert.ok(isGitHubApp("github") && usesConnect("github") && !isHosted("github") && !isAppSignIn("github"), "its own path: no person's token is kept, so not the app sign-in path");
assert.deepEqual([...p.readTools], [...GITHUB_TOOLS]);
assert.deepEqual(p.writeTools, [], "OPERATOR never pushes, opens or merges anything in GitHub");
assert.deepEqual(p.reportTools, []);
assert.deepEqual(checkedTools("github"), [...GITHUB_TOOLS]);
for (const t of GITHUB_TOOLS) assert.ok(mayCall("github", t) && !mayWrite("github", t) && !mayReport("github", t), t);
for (const bad of ["github_merge", "github_push", "github_create_pr", "github_comment", "github_close_issue", "create_pull_request", "merge_pull_request"]) assert.ok(!mayCall("github", bad) && !mayWrite("github", bad), `never ${bad}`);
assert.ok(!Object.keys(ACTIONS).some((a) => a.startsWith("github")), "no gateway action type for GitHub");
assert.deepEqual(READ_PERMISSIONS, { metadata: "read", pull_requests: "read", checks: "read", issues: "read" });

// ---- the catalog: four untrusted reads, all needing GitHub connected with a repo on
const tools = TOOL_LIST.filter((t) => t.group === "github");
assert.deepEqual(tools.map((t) => t.id).sort(), [...GITHUB_TOOLS].sort());
for (const t of tools) assert.ok(t.kind === "read" && !t.trusted && t.needs.includes("GITHUB_CONNECTED") && t.costUsd === 0, t.id);
const files = tools.find((t) => t.id === "github_pr_files")!;
assert.deepEqual(files.params.map((x) => x.name), ["repo", "pr"], "the repo is a number, never a name");
assert.ok(files.params.every((x) => x.type === "int"));

// ---- sign-in addresses and the install link
assert.equal(GITHUB_AUTH.authorization_endpoint, "https://github.com/login/oauth/authorize");
assert.equal(GITHUB_AUTH.token_endpoint, "https://github.com/login/oauth/access_token");
assert.ok(slugOk("operator-app") && !slugOk("Bad Slug") && !slugOk("../x") && !slugOk(""));
assert.equal(installUrl("operator-app"), "https://github.com/apps/operator-app/installations/new");

// ---- permissions: read only, and nothing more
assert.equal(permissionProblem({ metadata: "read", pull_requests: "read" }), null, "fewer is fine");
assert.equal(permissionProblem({ ...READ_PERMISSIONS }), null);
assert.match(permissionProblem({ pull_requests: "write" })!, /more than read.*pull_requests: write/);
assert.match(permissionProblem({ metadata: "read", contents: "read" })!, /contents: read/, "any permission not named is refused, even read");
assert.match(permissionProblem({ administration: "admin" })!, /administration/);
assert.ok(permissionProblem(null) && permissionProblem([]) && permissionProblem("read"));

// ---- installations: the person's list, each held to read only; suspended ones skipped
const inst = (id: unknown, login: unknown, perms: unknown = { metadata: "read", pull_requests: "read" }, extra: object = {}) => ({ id, account: { login }, permissions: perms, ...extra });
assert.deepEqual(readInstallations({ installations: [inst(11, "acme"), inst(12, "acme-labs"), inst(13, "gone", undefined, { suspended_at: "2026-01-01" })] }), { installations: [{ id: 11, account: "acme" }, { id: 12, account: "acme-labs" }] });
assert.deepEqual(readInstallations({ installations: [] }), { problem: NO_INSTALL });
assert.deepEqual(readInstallations({ installations: [inst(0, "x"), inst(5, "bad name")] }), { problem: NO_INSTALL }, "bad ids and logins are skipped");
assert.match((readInstallations({ installations: [inst(11, "acme", { contents: "write" })] }) as { problem: string }).problem, /more than read/);
assert.ok("problem" in readInstallations({}) && "problem" in readInstallations(null));
const installs = [{ id: 11, account: "acme" }, { id: 12, account: "Acme-Labs" }];
assert.equal(installationFor("acme/web", installs)?.id, 11);
assert.equal(installationFor("acme-labs/api", installs)?.id, 12, "owner matched without case");
assert.equal(installationFor("other/web", installs), null);

// ---- picked repos: at most five, only reachable ones, never a bad name
assert.ok(repoOk("acme/web") && repoOk("a-b/c.d_e") && !repoOk("acme") && !repoOk("acme/../x") && !repoOk("a/b/c") && !repoOk("acme/we b") && !repoOk(7));
assert.deepEqual(readRepos("acme/web\nACME/web\nnot a repo\n\nacme/api"), ["acme/web", "acme/api"], "repeats and bad lines dropped");
assert.deepEqual(readRepos(null), []);
assert.equal(readRepos(Array.from({ length: 9 }, (_, i) => `acme/r${i}`).join("\n")).length, MAX_REPOS);
assert.equal(writeRepos(["acme/web", "acme/api"]), "acme/web\nacme/api");
const reach = ["acme/web", "acme/api", "acme/docs", "acme/a", "acme/b", "acme/c"];
assert.deepEqual(toggleRepo("", "acme/web", true, reach), { repos: "acme/web" });
assert.deepEqual(toggleRepo("acme/web", "acme/api", true, reach), { repos: "acme/web\nacme/api" });
assert.deepEqual(toggleRepo("acme/web", "ACME/WEB", true, reach), { repos: "acme/web" }, "already on");
assert.deepEqual(toggleRepo("acme/web\nacme/api", "acme/web", false, []), { repos: "acme/api" }, "off needs no reach check");
assert.match((toggleRepo("", "acme/secret", true, reach) as { problem: string }).problem, /can't see that repo/);
assert.match((toggleRepo("acme/web\nacme/api\nacme/docs\nacme/a\nacme/b", "acme/c", true, reach) as { problem: string }).problem, /At most 5/);
assert.match((toggleRepo("", "../etc", true, reach) as { problem: string }).problem, /isn't a repo name/);

// ---- inputs: nothing but what each tool names; the repo by number
const picked = ["acme/web", "acme/api"];
assert.deepEqual(checkGitHubArgs("github_open_prs", {}, picked), { tool: "github_open_prs" });
assert.deepEqual(checkGitHubArgs("github_pr_files", { repo: 2, pr: 41 }, picked), { tool: "github_pr_files", repo: "acme/api", pr: 41 });
assert.deepEqual(checkGitHubArgs("github_pr_files", { pr: 41 }, picked), { tool: "github_pr_files", repo: "acme/web", pr: 41 }, "repo 1 by default");
for (const [tool, args, why] of [
  ["github_open_prs", { repo: "acme/secret" }, /unknown input: repo/],
  ["github_pr_files", { repo: "acme/secret", pr: 1 }, /repo is a number/],
  ["github_pr_files", { repo: 3, pr: 1 }, /from 1 to 2/],
  ["github_pr_files", { repo: 1, pr: -4 }, /pr is a pull request number/],
  ["github_pr_files", { repo: 1, pr: 1.5 }, /pr is a pull request number/],
  ["github_pr_files", { repo: 1, pr: 1, owner: "x" }, /unknown input: owner/],
  ["github_merge", {}, /isn't a GitHub read tool/],
] as const) assert.match((checkGitHubArgs(tool, args, picked) as { problem: string }).problem, why, `${tool} ${JSON.stringify(args)}`);
assert.match((checkGitHubArgs("github_checks", {}, []) as { problem: string }).problem, /no repo is turned on/);

// ---- reading GitHub's answers: counted here, text cut and cleaned
const run = (status: string, conclusion: string | null, name = "build") => ({ status, conclusion, name });
assert.deepEqual(checksOf({ check_runs: [run("completed", "success"), run("completed", "skipped")] }), { state: "passing", passed: 2, failed: 0, pending: 0, failing: [] });
assert.deepEqual(checksOf({ check_runs: [run("completed", "success"), run("in_progress", null)] }).state, "pending");
assert.deepEqual(checksOf({ check_runs: [run("completed", "failure", "lint"), run("in_progress", null)] }), { state: "failing", passed: 0, failed: 1, pending: 1, failing: ["lint"] });
assert.equal(checksOf({ check_runs: [] }).state, "none");
assert.equal(checksOf(null).state, "none");
assert.equal(checksOf({ check_runs: Array.from({ length: 30 }, (_, i) => run("completed", "failure", `c${i}`)) }).failing.length, 10);
const pr = (n: number, o: object = {}) => ({ number: n, title: `Fix thing ${n}`, draft: false, created_at: new Date(now - 5 * day).toISOString(), updated_at: new Date(now - 2 * day).toISOString(), head: { ref: `operator/b_ada/${n}`, sha: "a".repeat(40) }, ...o });
const row = readPr(pr(7, { title: "Ship\u0007 it\n now".padEnd(200, "!") }), 1, "acme/web", "failing", 3, now)!;
assert.equal(row.age_days, 5);
assert.equal(row.days_quiet, 2);
assert.equal(row.files_changed, 3);
assert.equal(row.title.length, 120, "titles are cut");
assert.doesNotMatch(row.title, /[\u0000-\u001f]/, "no control characters");
assert.equal(readPr({ number: "7" }, 1, "acme/web", "none", null, now), null);
const rows = [row, readPr(pr(8, { draft: true }), 1, "acme/web", "passing", 1, now)!, readPr(pr(9), 2, "acme/api", "pending", 1, now)!];
assert.deepEqual(prTotals(rows, 12), { open_prs: 12, draft_prs: 1, failing_prs: 1, waiting_prs: 1, oldest_pr_days: 5 });
assert.deepEqual(prTotals([], 0), { open_prs: 0, draft_prs: 0, failing_prs: 0, waiting_prs: 0, oldest_pr_days: 0 });
assert.equal(readPaths(Array.from({ length: 80 }, (_, i) => ({ filename: `src/f${i}.ts` }))).length, MAX_PATHS);
assert.deepEqual(readPaths([{ filename: "a.ts" }, null, {}]), ["a.ts"]);
const issues = readIssues([{ number: 3, title: "Bug", labels: [{ name: "bug" }, "p1"], created_at: new Date(now - day).toISOString() }, { number: 4, title: "A PR", pull_request: {} }], 1, "acme/web", now);
assert.deepEqual(issues, [{ repo_no: 1, repo: "acme/web", issue: 3, title: "Bug", labels: ["bug", "p1"], age_days: 1 }], "pull requests are left out of issues");
assert.equal(readIssues(Array.from({ length: 40 }, (_, i) => ({ number: i + 1, title: "x" })), 1, "acme/web", now).length, MAX_ISSUES);
assert.deepEqual(readRepoList({ repositories: [{ full_name: "acme/web", default_branch: "main" }, { full_name: "bad" }] }), [{ name: "acme/web", defaultBranch: "main" }]);

// ---- tokens: the App's JWT and a narrowed request
assert.deepEqual(appClaims("123", now), { iat: now / 1000 - 60, exp: now / 1000 + 540, iss: "123" });
assert.deepEqual(tokenRequestBody(["acme/web", "acme/api"]), { repositories: ["web", "api"], permissions: READ_PERMISSIONS });
assert.ok(TOKEN_REUSE_MS < 60 * 60_000, "reused for less than GitHub's hour");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const app = { id: "123", key: pem.replace(/\n/g, "\\n") };
const jwt = githubAppJwt(app, now);
const [h, c, sig] = jwt.split(".");
assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
assert.deepEqual(JSON.parse(Buffer.from(c, "base64url").toString()), appClaims("123", now));
assert.ok(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, sig, "base64url"), "signed with the App's key (escaped newlines from Vercel work)");

// ---- the server, end to end, on a fake GitHub
type Call = { method: string; path: string; auth: string; body: unknown; redirect: string | undefined; headers: Record<string, string> };
function fakeGitHub(reply: (c: Call) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    assert.ok(url.startsWith(GITHUB_API + "/"), `only GitHub's API: ${url}`);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = { method: init?.method ?? "GET", path: url.slice(GITHUB_API.length), auth: headers.Authorization ?? "", body: init?.body ? JSON.parse(String(init.body)) : null, redirect: init?.redirect, headers };
    calls.push(call);
    const r = reply(call);
    return new Response(r.status === 204 ? null : JSON.stringify(r.json), { status: r.status });
  }) as typeof fetch;
  return calls;
}
const minted = (repos: string[] | null, perms: object = { metadata: "read", pull_requests: "read", checks: "read", issues: "read" }) => ({ status: 201, json: { token: `ghs_${repos?.join("_") ?? "meta"}`, permissions: perms } });
const github = (extra: (c: Call) => { status: number; json: unknown } | null = () => null) => (c: Call) => {
  const e = extra(c);
  if (e) return e;
  if (c.method === "POST" && /^\/app\/installations\/\d+\/access_tokens$/.test(c.path)) return minted((c.body as { repositories?: string[] }).repositories ?? null, (c.body as { permissions: object }).permissions);
  if (c.path === "/repos/acme/web/pulls?state=open&per_page=100") return { status: 200, json: [pr(7), pr(8, { draft: true })] };
  if (c.path === "/repos/acme/api/pulls?state=open&per_page=100") return { status: 200, json: Array.from({ length: 12 }, (_, i) => pr(100 + i)) };
  if (/^\/repos\/acme\/\w+\/pulls\/\d+$/.test(c.path)) return { status: 200, json: { ...pr(Number(c.path.split("/").pop())), changed_files: 4, state: "open" } };
  if (/^\/repos\/acme\/\w+\/pulls\/\d+\/files/.test(c.path)) return { status: 200, json: [{ filename: "src/a.ts" }, { filename: "src/b.ts" }] };
  if (/check-runs/.test(c.path)) return { status: 200, json: { check_runs: [run("completed", c.path.includes("acme/api") ? "failure" : "success")] } };
  if (c.path === "/repos/acme/web" || c.path === "/repos/acme/api") return { status: 200, json: { default_branch: "main" } };
  if (/\/issues\?/.test(c.path)) return { status: 200, json: [{ number: 3, title: "Bug", labels: [], created_at: new Date(now - day).toISOString() }, { number: 7, title: "PR", pull_request: {} }] };
  return { status: 404, json: { message: "Not Found" } };
};
const call = async (srv: (raw: unknown) => Promise<unknown>, name: string, args: unknown = {}) => {
  const r = (await srv({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as { result: { isError?: boolean; structuredContent?: { result: Record<string, unknown> }; content: { text: string }[] } };
  if (r.result.isError) return { error: r.result.content[0].text };
  return r.result.structuredContent!.result;
};

(async () => {
  const one = [{ id: 11, account: "acme" }];
  let calls = fakeGitHub(github());
  const srv = githubServer(app, one, picked, () => now);
  const list = (await srv({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), [...GITHUB_TOOLS]);
  assert.ok(list.result.tools.every((t) => t.annotations.readOnlyHint));

  const prs = await call(srv, "github_open_prs") as { prs: { repo_no: number; checks: string; files_changed: number }[]; totals: Record<string, number>; truncated: boolean };
  assert.equal(prs.prs.length, 2 + MAX_PRS, "at most MAX_PRS read per repo");
  assert.deepEqual(prs.totals, { open_prs: 14, draft_prs: 1, failing_prs: MAX_PRS, waiting_prs: 1, oldest_pr_days: 5 });
  assert.equal(prs.truncated, true);
  assert.ok(prs.prs.every((r) => r.files_changed === 4));
  const mints = calls.filter((x) => x.path.endsWith("/access_tokens"));
  assert.equal(mints.length, 1, "one token for both repos on the account, reused for the whole call");
  assert.deepEqual(mints[0].body, { repositories: ["web", "api"], permissions: READ_PERMISSIONS });
  assert.match(mints[0].auth, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/, "minted with the App's JWT");
  for (const x of calls) {
    assert.equal(x.redirect, "error", "a request carrying a token never follows a redirect");
    assert.equal(x.headers["X-GitHub-Api-Version"], "2022-11-28");
    if (!x.path.endsWith("/access_tokens")) assert.ok(x.method === "GET" && x.auth === "Bearer ghs_web_api", `reads only, with the narrowed token: ${x.method} ${x.path}`);
  }

  calls = fakeGitHub(github());
  const f = await call(srv, "github_pr_files", { repo: 2, pr: 105 }) as Record<string, unknown>;
  assert.deepEqual(f, { repo_no: 2, repo: "acme/api", pr: 105, branch: "operator/b_ada/105", title: "Fix thing 105", open: true, files_changed: 4, paths: ["src/a.ts", "src/b.ts"], truncated: true });
  assert.equal(calls.filter((x) => x.path.endsWith("/access_tokens")).length, 0, "the token minted a moment ago is reused");
  assert.match(String((await call(srv, "github_pr_files", { repo: "acme/secret", pr: 1 }) as { error: string }).error), /Input refused: repo is a number/);
  assert.match(String((await call(srv, "github_merge", {}) as { error: string }).error), /isn't a GitHub read tool/);

  const is = await call(srv, "github_open_issues") as { issues: unknown[]; totals: Record<string, number> };
  assert.equal(is.issues.length, 2, "one issue per repo; pull requests left out");
  const ch = await call(srv, "github_checks") as { repos: { repo: string; branch: string; state: string }[]; totals: Record<string, number> };
  assert.deepEqual(ch.repos.map((r) => [r.repo, r.branch, r.state]), [["acme/web", "main", "passing"], ["acme/api", "main", "failing"]]);
  assert.deepEqual(ch.totals, { failing_repos: 1, pending_repos: 0 });

  // a token that carries more than read is refused, and says so in a way that pauses GitHub
  fakeGitHub(github((c) => (c.path.endsWith("/access_tokens") ? minted(["x"], { ...READ_PERMISSIONS, contents: "write" }) : null)));
  const wide = githubServer(app, [{ id: 21, account: "acme" }], picked, () => now);
  assert.match(String((await call(wide, "github_checks") as { error: string }).error), /^GitHub refused: .*more than read.*contents: write/);
  // an install that's gone pauses too; a bad App key doesn't (it's the app's setup, not the business's)
  fakeGitHub(github((c) => (c.path.endsWith("/access_tokens") ? { status: 404, json: {} } : null)));
  assert.match(String((await call(githubServer(app, [{ id: 22, account: "acme" }], picked), "github_checks") as { error: string }).error), /^GitHub refused: the OPERATOR app isn't installed on acme/);
  fakeGitHub(github((c) => (c.path.endsWith("/access_tokens") ? { status: 401, json: {} } : null)));
  assert.match(String((await call(githubServer(app, [{ id: 23, account: "acme" }], picked), "github_checks") as { error: string }).error), /^GitHub app: .*GITHUB_APP_PRIVATE_KEY/);
  // a repo on an account with no install is never read
  fakeGitHub(github());
  assert.match(String((await call(githubServer(app, one, ["other/web"]), "github_checks") as { error: string }).error), /isn't installed on other/);

  // Connect: the person's token lists installs, then is cancelled with the App's client id and secret
  calls = fakeGitHub((c) => (c.path.startsWith("/user/installations") ? { status: 200, json: { installations: [inst(11, "acme")] } } : c.method === "DELETE" ? { status: 204, json: null } : { status: 404, json: {} }));
  assert.deepEqual(await githubInstallations("ghu_person"), { installations: [{ id: 11, account: "acme" }] });
  assert.equal(calls[0].auth, "Bearer ghu_person");
  assert.equal(await githubRevokeUserToken("Iv1.abc", "shh", "ghu_person"), true);
  const del = calls[1];
  assert.equal(del.method, "DELETE");
  assert.equal(del.path, "/applications/Iv1.abc/token");
  assert.equal(del.auth, `Basic ${Buffer.from("Iv1.abc:shh").toString("base64")}`);
  assert.deepEqual(del.body, { access_token: "ghu_person" });

  // Connections' repo lines never fail the page
  fakeGitHub(github((c) => (c.path.startsWith("/repos/acme/api") ? { status: 500, json: { message: "boom" } } : null)));
  const lines = await githubRepoLines(app, [{ id: 31, account: "acme" }], picked);
  assert.deepEqual(lines[0], { repo: "acme/web", branch: "main", openPrs: 2, checks: "passing", problem: null });
  assert.equal(lines[1].openPrs, null);
  assert.match(lines[1].problem!, /GitHub 500/);

  // ---- wiring
  const src = (f: string) => readFileSync(f, "utf8");
  const filesOf = (d: string): string[] => readdirSync(d).flatMap((x) => { const q = join(d, x); return statSync(q).isDirectory() ? (x === "node_modules" ? [] : filesOf(q)) : /\.tsx?$/.test(x) ? [q] : []; });
  const all = ["core", "agents", "packs", "dashboard", "app", "integrations", "ee"].flatMap(filesOf);
  assert.deepEqual(all.filter((x) => /from "[^"]*\/github-server"/.test(src(x))), ["integrations/mcp.ts"], "only the MCP client reaches our GitHub server");
  assert.deepEqual(all.filter((x) => x !== "core/github-rules.ts" && /api\.github\.com/.test(src(x))), [], "GitHub's API address lives only in the rules");
  const server = src("integrations/github-server.ts").replace(/^\s*(\/\/|\*).*$/gm, "");
  assert.deepEqual([...new Set([...server.matchAll(/method: "(POST|PUT|PATCH|DELETE)"/g)].map((m) => m[1]))].sort(), ["DELETE", "POST"], "the only non-GET calls: minting a token (POST) and cancelling the person's sign-in (DELETE)");
  assert.doesNotMatch(server, /\/merge|\/comments|\/reviews|\/labels|\/git\/refs|\/contents\/|"PUT"|"PATCH"/, "no merge, comment, review, label, ref or file write");
  assert.match(src("integrations/mcp.ts"), /if \(isGitHubApp\(id\)\) return callGitHubTool\(tool, args\);/);
  assert.match(src("integrations/mcp.ts"), /githubRevokeUserToken\(/, "the person's token is cancelled after Connect");
  assert.doesNotMatch(src("integrations/mcp.ts").match(/interface GitHubSecret \{[^}]*\}/)![0], /token/i, "the vault keeps only the installs, no token");
  assert.match(src("dashboard/connectionActions.ts"), /export async function githubSetRepo[\s\S]{0,120}asRole\("owner"\)/, "only an owner turns a repo on or off");
  assert.match(src("eslint.config.mjs"), /GHSRV/);
  assert.match(src("dashboard/builder.ts"), /GITHUB_CONNECTED: h\.github/);
  assert.match(src("dashboard/data.ts"), /github: !!mcp\.github\?\.settings\.repos/, "set up only once a repo is turned on");
  assert.doesNotMatch(src("app/(room)/connections/page.tsx"), /router\.refresh/);
  console.log("github: ok");
})().catch((e) => { console.error(e); process.exit(1); });
