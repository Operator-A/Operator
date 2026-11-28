import "server-only";
// Our own GitHub MCP server (engineering isolation slice 1, docs/engineering.md). Read only: GitHub's hosted
// MCP server signs in as a person with everything that person can do, so this one runs in the app over
// GitHub's REST API, on the business's install of OPERATOR's GitHub App. It is the only file that calls
// GitHub's API, and only integrations/mcp.ts reaches it (lint, check:mcp).
// - Each call mints a one-hour installation token, narrowed to READ_PERMISSIONS and to the repos the owner
//   turned on (core/github-rules.ts). GitHub's answer lists what the token may do: anything more is refused.
// - There is no push, merge, comment, review, label or close call, and none may be added (check:github).
// PR titles, branch names, labels and paths are untrusted data, cut short in core/github-rules.ts.
import { createSign } from "node:crypto";
import { MCP_PROTOCOL } from "@/core/mcp-rules";
import {
  GITHUB_API, GITHUB_API_VERSION, GITHUB_TOOLS, MAX_PRS, READ_PERMISSIONS, TOKEN_REUSE_MS, appClaims, checkGitHubArgs, checksOf, installationFor, permissionProblem, prOk, prTotals,
  readInstallations, readIssues, readPaths, readPr, readRepoList, tokenRequestBody, type ChecksState, type Installation, type PrRow,
} from "@/core/github-rules";

const TIMEOUT_MS = 20_000;
const UA = "OPERATOR-app";

/** OPERATOR's GitHub App, from Vercel: its id and its private key (PEM). */
export interface GitHubApp { id: string; key: string }

const DESCRIPTIONS: Record<string, string> = {
  github_open_prs: "Open pull requests in the repos turned on for agents: branch, title, draft, age, days quiet, files changed and checks state, with totals counted in code.",
  github_pr_files: "The file paths one open pull request changes. Name the repo by its number from github_open_prs and the pull request by its number.",
  github_open_issues: "Open issues in the repos turned on for agents: number, title, labels and age.",
  github_checks: "The check results on each repo's default branch: passing, failing or pending, and which checks fail.",
};

type Res = { status: number; json: unknown };
async function gh(token: string, path: string, init?: { method: "POST" | "DELETE"; body: unknown; basic?: boolean }): Promise<Res> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: init?.method ?? "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: init?.basic ? `Basic ${token}` : `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": GITHUB_API_VERSION, "User-Agent": UA, ...(init ? { "Content-Type": "application/json" } : {}) },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const said = (j: unknown) => JSON.stringify((j as { message?: unknown } | null)?.message ?? "").slice(0, 160);
const must = (r: Res, what: string) => {
  if (r.status < 200 || r.status >= 300) throw new Error(`GitHub ${r.status} on ${what}: ${said(r.json)}`);
  return r.json;
};
const repoPath = (repo: string) => { const [o, n] = repo.split("/"); return `/repos/${encodeURIComponent(o)}/${encodeURIComponent(n)}`; };

/** The App's own JWT (RS256), good for nine minutes. Only used to mint installation tokens. */
export function githubAppJwt(app: GitHubApp, nowMs = Date.now()): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(appClaims(app.id, nowMs))}`;
  const sig = createSign("RSA-SHA256").update(head).end().sign(app.key.replace(/\\n/g, "\n"), "base64url");
  return `${head}.${sig}`;
}

// minted tokens, reused for TOKEN_REUSE_MS. The key names the installation and the exact repos and
// permissions asked for; an installation is the business's own, checked against the person at Connect.
// The promise is kept, so reads running side by side share one mint.
const minted = new Map<string, { token: Promise<string>; at: number }>();

/**
 * An installation token for these repos (names with owner), read only. No repos: metadata only, across
 * the install, to list the repos it can see. GitHub's list of what the token may do is checked again.
 */
function mint(app: GitHubApp, inst: Installation, repos: readonly string[]): Promise<string> {
  const key = `${inst.id}|${repos.map((r) => r.toLowerCase()).sort().join(",")}`;
  const hit = minted.get(key);
  if (hit && Date.now() - hit.at < TOKEN_REUSE_MS) return hit.token;
  const token = mintNow(app, inst, repos);
  minted.set(key, { token, at: Date.now() });
  token.catch(() => { if (minted.get(key)?.token === token) minted.delete(key); });
  return token;
}

async function mintNow(app: GitHubApp, inst: Installation, repos: readonly string[]): Promise<string> {
  const body = repos.length ? tokenRequestBody(repos) : { permissions: { metadata: READ_PERMISSIONS.metadata } };
  const r = await gh(githubAppJwt(app), `/app/installations/${inst.id}/access_tokens`, { method: "POST", body });
  if (r.status === 401) throw new Error("GitHub app: GitHub didn't accept OPERATOR's app key (401). Check GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY in Vercel");
  if (r.status === 404) throw new Error(`GitHub refused: the OPERATOR app isn't installed on ${inst.account} any more`);
  if (r.status === 422) throw new Error(`GitHub 422: the OPERATOR app can't see one of the picked repos on ${inst.account}. Add it with Change repos on GitHub, or turn it off on Connections`);
  const j = must(r, "a read token") as { token?: unknown; permissions?: unknown };
  const problem = permissionProblem(j.permissions);
  if (problem) throw new Error(`GitHub refused: ${problem}`);
  if (typeof j.token !== "string" || !j.token) throw new Error("GitHub 500: GitHub didn't hand over a read token");
  return j.token;
}

/** Forgets the tokens minted for an installation (after GitHub stops taking one). */
const forget = (inst: Installation) => { for (const k of minted.keys()) if (k.startsWith(`${inst.id}|`)) minted.delete(k); };

/** The App's installations a person's sign-in reaches, held to READ_PERMISSIONS. The person's token is used for this alone. */
export async function githubInstallations(userToken: string): Promise<ReturnType<typeof readInstallations>> {
  return readInstallations(must(await gh(userToken, "/user/installations?per_page=100"), "list the app's installations"));
}

/** Cancels a person's sign-in at GitHub once its one job is done (the App's client id and secret, as Basic auth). */
export async function githubRevokeUserToken(clientId: string, clientSecret: string, userToken: string): Promise<boolean> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const r = await gh(basic, `/applications/${encodeURIComponent(clientId)}/token`, { method: "DELETE", body: { access_token: userToken }, basic: true }).catch(() => null);
  return r?.status === 204;
}

/** Every repo the installs can see (owner/name, default branch), for the picker on Connections. */
export async function githubReachableRepos(app: GitHubApp, installations: readonly Installation[]): Promise<{ name: string; defaultBranch: string }[]> {
  const lists = await Promise.all(installations.map(async (inst) => readRepoList(must(await gh(await mint(app, inst, []), "/installation/repositories?per_page=100"), "list the repos the app can see"))));
  return lists.flat();
}

/** A token for one picked repo: minted for every picked repo on the same account, so one token serves them all. */
function tokens(app: GitHubApp, installations: readonly Installation[], repos: readonly string[]) {
  return async (repo: string): Promise<{ token: string; inst: Installation }> => {
    const inst = installationFor(repo, installations);
    if (!inst) throw new Error(`GitHub 404: the OPERATOR app isn't installed on ${repo.split("/")[0]}`);
    return { token: await mint(app, inst, repos.filter((r) => installationFor(r, installations)?.id === inst.id)), inst };
  };
}

/** A repo's default branch and the checks on it. */
async function branchChecks(token: string, repo: string) {
  const info = must(await gh(token, repoPath(repo)), `read ${repo}`) as { default_branch?: unknown };
  const branch = String(info?.default_branch ?? "main").slice(0, 100);
  const c = checksOf(must(await gh(token, `${repoPath(repo)}/commits/${encodeURIComponent(branch)}/check-runs?per_page=100`), `read checks on ${repo}`));
  return { branch, ...c };
}

/** For Connections: each picked repo's default branch, open pull requests (counted to 100) and checks. Never fails the page. */
export async function githubRepoLines(app: GitHubApp, installations: readonly Installation[], repos: readonly string[]): Promise<{ repo: string; branch: string | null; openPrs: number | null; checks: ChecksState | null; problem: string | null }[]> {
  const tokenFor = tokens(app, installations, repos);
  return Promise.all(repos.map(async (repo) => {
    try {
      const { token } = await tokenFor(repo);
      const [b, pulls] = await Promise.all([branchChecks(token, repo), gh(token, `${repoPath(repo)}/pulls?state=open&per_page=100`)]);
      return { repo, branch: b.branch, openPrs: Array.isArray(must(pulls, `list pull requests on ${repo}`)) ? (pulls.json as unknown[]).length : 0, checks: b.state, problem: null };
    } catch (e) {
      return { repo, branch: null, openPrs: null, checks: null, problem: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
    }
  }));
}

/** A JSON-RPC handler for one call: the four read tools, over the picked repos only, with tokens minted for this call. */
export function githubServer(app: GitHubApp, installations: readonly Installation[], repos: readonly string[], now: () => number = Date.now) {
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  const tokenFor = tokens(app, installations, repos);
  // a 401 on a minted token means GitHub stopped taking it: forget it so the next call mints another
  const read = async (repo: string, path: string, what: string) => {
    const { token, inst } = await tokenFor(repo);
    const r = await gh(token, path);
    if (r.status === 401) forget(inst);
    return must(r, what);
  };
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-github", version: "1" } });
      case "tools/list":
        return reply(id, { tools: GITHUB_TOOLS.map((name) => ({ name, description: DESCRIPTIONS[name], annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        const a = checkGitHubArgs(name, req.params?.arguments, repos);
        if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
        try {
          const list = repos.map((repo, i) => ({ repo_no: i + 1, repo }));
          let result: unknown;
          if (a.tool === "github_open_prs") {
            const per = await Promise.all(list.map(async ({ repo_no, repo }) => {
              const open = (await read(repo, `${repoPath(repo)}/pulls?state=open&per_page=100`, `list pull requests on ${repo}`)) as { number?: unknown; head?: { sha?: unknown } }[];
              const rows = await Promise.all((Array.isArray(open) ? open : []).slice(0, MAX_PRS).map(async (p) => {
                if (!prOk(p.number)) return null;
                const sha = String(p.head?.sha ?? "");
                const [detail, checks] = await Promise.all([
                  read(repo, `${repoPath(repo)}/pulls/${p.number}`, `read pull request ${p.number}`) as Promise<{ changed_files?: unknown }>,
                  /^[0-9a-f]{40}$/.test(sha) ? read(repo, `${repoPath(repo)}/commits/${sha}/check-runs?per_page=100`, `read checks on ${p.number}`) : null,
                ]);
                return readPr(p, repo_no, repo, checksOf(checks).state, Number(detail?.changed_files ?? 0), now());
              }));
              return { rows: rows.filter((r): r is PrRow => !!r), open: Array.isArray(open) ? open.length : 0 };
            }));
            const prs = per.flatMap((p) => p.rows);
            const open = per.reduce((n, p) => n + p.open, 0);
            result = { repos: list, prs, totals: prTotals(prs, open), truncated: per.some((p) => p.open > MAX_PRS) };
          } else if (a.tool === "github_pr_files") {
            const repo_no = repos.indexOf(a.repo) + 1;
            const [detail, files] = await Promise.all([
              read(a.repo, `${repoPath(a.repo)}/pulls/${a.pr}`, `read pull request ${a.pr}`) as Promise<{ title?: unknown; head?: { ref?: unknown }; changed_files?: unknown; state?: unknown; created_at?: unknown; updated_at?: unknown; draft?: unknown; number?: unknown }>,
              read(a.repo, `${repoPath(a.repo)}/pulls/${a.pr}/files?per_page=100`, `list files of ${a.pr}`),
            ]);
            const row = readPr(detail, repo_no, a.repo, "none", Number(detail?.changed_files ?? 0), now());
            const paths = readPaths(files);
            result = { repo_no, repo: a.repo, pr: a.pr, branch: row?.branch ?? "", title: row?.title ?? "", open: detail?.state === "open", files_changed: row?.files_changed ?? paths.length, paths, truncated: (row?.files_changed ?? 0) > paths.length };
          } else if (a.tool === "github_open_issues") {
            const per = await Promise.all(list.map(async ({ repo_no, repo }) => readIssues(await read(repo, `${repoPath(repo)}/issues?state=open&per_page=50&sort=created&direction=desc`, `list issues on ${repo}`), repo_no, repo, now())));
            const issues = per.flat();
            result = { repos: list, issues, totals: { open_issues_listed: issues.length } };
          } else {
            const per = await Promise.all(list.map(async ({ repo_no, repo }) => {
              const { token } = await tokenFor(repo);
              return { repo_no, repo, ...(await branchChecks(token, repo)) };
            }));
            result = { repos: per, totals: { failing_repos: per.filter((r) => r.state === "failing").length, pending_repos: per.filter((r) => r.state === "pending").length } };
          }
          return reply(id, { structuredContent: { result }, content: [{ type: "text", text: "ok" }] });
        } catch (e) {
          return toolError(id, e instanceof Error ? e.message : String(e));
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `no method ${req.method}` } };
    }
  };
}
