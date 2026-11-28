// GitHub (engineering isolation slice 1, docs/engineering.md). Pure, so `npm run check:github` can test it
// with no network.
//
// Read only. Our own server (integrations/github-server.ts) runs in the app over GitHub's REST API, on the
// business's install of OPERATOR's GitHub App:
// - Connect is GitHub's web sign-in for that App (state and PKCE). The person's token is used once, to list
//   the App's installations they can reach (GET /user/installations), so an installation id is never taken
//   from a URL, and is then revoked. Only the installations (id, account) are kept, in the vault.
// - Each call mints a one-hour installation token narrowed to READ_PERMISSIONS and to the picked repos of
//   that account. GitHub's answer lists what the token may do; anything more than READ_PERMISSIONS refuses it.
// - Agents read only repos the owner turned on on Connections (at most MAX_REPOS), never a repo a model typed.
// - There is no write tool and no gateway action type: OPERATOR never pushes, opens or merges anything.
// PR titles, branch names, labels and file paths were written by people outside the business's control,
// so they are untrusted data and cut short; every count and age is worked out here.

export const GITHUB_TOOLS = ["github_open_prs", "github_pr_files", "github_open_issues", "github_checks"] as const;
export type GitHubTool = (typeof GITHUB_TOOLS)[number];

export const GITHUB_API = "https://api.github.com";
export const GITHUB_WEB = "https://github.com";
/** Pinned so a change on GitHub's side can't change what a call returns. */
export const GITHUB_API_VERSION = "2022-11-28";

/** GitHub's fixed sign-in addresses for a GitHub App's web flow (no self-registration: OPERATOR's own App). */
export const GITHUB_AUTH = {
  authorization_endpoint: `${GITHUB_WEB}/login/oauth/authorize`,
  token_endpoint: `${GITHUB_WEB}/login/oauth/access_token`,
} as const;

/** Every permission a token may carry, all read. Metadata comes with every GitHub App. */
export const READ_PERMISSIONS = { metadata: "read", pull_requests: "read", checks: "read", issues: "read" } as const;
/** The profile's scopes, in words, as Connections shows them. */
export const GITHUB_SCOPES = ["pull requests: read", "checks: read", "issues: read", "metadata: read"] as const;

/** At most this many repos may be turned on for agents. */
export const MAX_REPOS = 5;
/** Open pull requests read per repo; the ones past this are counted, never guessed. */
export const MAX_PRS = 10;
/** File paths listed for one pull request. */
export const MAX_PATHS = 50;
/** Open issues listed per repo. */
export const MAX_ISSUES = 20;
/** Failing check names listed. */
export const MAX_FAILING = 10;

/** owner/name as GitHub allows them: owner 1 to 39, repo 1 to 100. */
export const REPO = /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
export const repoOk = (s: unknown): s is string => typeof s === "string" && REPO.test(s) && !s.includes("..");
export const installationOk = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
export const prOk = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) < 1e9;
/** A GitHub App's slug, as in github.com/apps/<slug>. */
export const slugOk = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,99}$/.test(s);

/** Where the owner installs the App, or changes which repos it may see. */
export const installUrl = (slug: string) => `${GITHUB_WEB}/apps/${slug}/installations/new`;

const plain = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
const daysSince = (iso: unknown, nowMs: number) => { const t = Date.parse(String(iso ?? "")); return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86_400_000)) : 0; };

/**
 * Why a permission list is refused: anything not in READ_PERMISSIONS, or more than read. Used on each
 * installation at Connect and on every minted token. Null when it fits.
 */
export function permissionProblem(perms: unknown): string | null {
  if (!perms || typeof perms !== "object" || Array.isArray(perms)) return "GitHub didn't say what this sign-in may do";
  const extra: string[] = [];
  for (const [k, v] of Object.entries(perms as Record<string, unknown>)) {
    const allowed = (READ_PERMISSIONS as Record<string, string>)[k];
    if (!allowed) extra.push(`${k}: ${plain(v, 10)}`);
    else if (v !== "read") extra.push(`${k}: ${plain(v, 10)}`);
  }
  return extra.length ? `the OPERATOR app on GitHub may do more than read (${extra.slice(0, 6).join(", ")}). Set it to read only in its permissions` : null;
}

export interface Installation { id: number; account: string }
/** No install of the App this person can reach yet: Connect goes on to GitHub's install page instead of failing. */
export const NO_INSTALL = "this GitHub account can't reach an install of the OPERATOR app yet";

/** The App's installations a person can reach, from GET /user/installations: id and account, each read only. */
export function readInstallations(j: unknown): { installations: Installation[] } | { problem: string } {
  const list = ((j ?? {}) as { installations?: unknown }).installations;
  if (!Array.isArray(list)) return { problem: "GitHub didn't list the app's installations" };
  const out: Installation[] = [];
  for (const raw of list) {
    const i = (raw ?? {}) as { id?: unknown; account?: { login?: unknown }; permissions?: unknown; suspended_at?: unknown };
    const account = String(i.account?.login ?? "");
    if (!installationOk(i.id) || !/^[A-Za-z0-9-]{1,39}$/.test(account) || i.suspended_at) continue;
    const no = permissionProblem(i.permissions);
    if (no) return { problem: no };
    out.push({ id: i.id, account });
  }
  if (!out.length) return { problem: NO_INSTALL };
  return { installations: out.slice(0, 20) };
}

/** The installation a repo is reached through: the one on the repo's owner. Null when none is. */
export const installationFor = (repo: string, list: readonly Installation[]) => list.find((i) => i.account.toLowerCase() === repo.split("/")[0].toLowerCase()) ?? null;

/** The picked repos, as kept in the connection's settings (one per line). Bad or repeated lines are dropped. */
export function readRepos(saved: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of String(saved ?? "").split(/\n+/)) {
    const r = line.trim();
    if (!repoOk(r) || seen.has(r.toLowerCase())) continue;
    seen.add(r.toLowerCase());
    out.push(r);
  }
  return out.slice(0, MAX_REPOS);
}
export const writeRepos = (list: readonly string[]) => list.join("\n");

/** Turns one repo on or off in the picked list, or says why not. Only a repo the installs can reach may be turned on. */
export function toggleRepo(saved: string | null | undefined, repo: string, on: boolean, reachable: readonly string[]): { repos: string } | { problem: string } {
  if (!repoOk(repo)) return { problem: "That isn't a repo name." };
  const list = readRepos(saved);
  const has = list.some((r) => r.toLowerCase() === repo.toLowerCase());
  if (!on) return { repos: writeRepos(list.filter((r) => r.toLowerCase() !== repo.toLowerCase())) };
  if (has) return { repos: writeRepos(list) };
  if (!reachable.some((r) => r.toLowerCase() === repo.toLowerCase())) return { problem: "The OPERATOR app on GitHub can't see that repo. Add it with Change repos on GitHub first." };
  if (list.length >= MAX_REPOS) return { problem: `At most ${MAX_REPOS} repos can be read. Turn one off first.` };
  return { repos: writeRepos([...list, repo]) };
}

/** A read tool's input, checked again on our server. Anything not named here is refused. */
export function checkGitHubArgs(tool: string, raw: unknown, repos: readonly string[]): { tool: "github_open_prs" | "github_open_issues" | "github_checks" } | { tool: "github_pr_files"; repo: string; pr: number } | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed: Record<string, string[]> = { github_open_prs: [], github_open_issues: [], github_checks: [], github_pr_files: ["repo", "pr"] };
  if (!(tool in allowed)) return { problem: `${tool || "that"} isn't a GitHub read tool` };
  const extra = Object.keys(a).filter((k) => !allowed[tool].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  if (!repos.length) return { problem: "no repo is turned on for agents on Connections" };
  if (tool !== "github_pr_files") return { tool: tool as "github_open_prs" | "github_open_issues" | "github_checks" };
  // the repo is a number in the list shown by the other tools, never a name a model typed
  const n = a.repo === undefined ? 1 : Number(a.repo);
  if (!Number.isInteger(n) || n < 1 || n > repos.length) return { problem: `repo is a number from 1 to ${repos.length}` };
  if (!prOk(a.pr)) return { problem: "pr is a pull request number" };
  return { tool: "github_pr_files", repo: repos[n - 1], pr: a.pr };
}

export type ChecksState = "passing" | "failing" | "pending" | "none";
/** The state of a set of check runs: failing if any failed, pending if any still runs, else passing. */
export function checksOf(j: unknown): { state: ChecksState; passed: number; failed: number; pending: number; failing: string[] } {
  const runs = ((j ?? {}) as { check_runs?: unknown }).check_runs;
  let passed = 0, failed = 0, pending = 0;
  const failing: string[] = [];
  for (const raw of Array.isArray(runs) ? runs : []) {
    const r = (raw ?? {}) as { status?: unknown; conclusion?: unknown; name?: unknown };
    if (r.status !== "completed") { pending++; continue; }
    if (["success", "neutral", "skipped"].includes(String(r.conclusion))) passed++;
    else { failed++; if (failing.length < MAX_FAILING) failing.push(plain(r.name, 80)); }
  }
  const state: ChecksState = failed ? "failing" : pending ? "pending" : passed ? "passing" : "none";
  return { state, passed, failed, pending, failing };
}

export interface PrRow { repo_no: number; repo: string; pr: number; branch: string; title: string; draft: boolean; age_days: number; days_quiet: number; files_changed: number; checks: ChecksState }

/** One open pull request from GitHub's list and detail, with its checks state. Branch and title are untrusted. */
export function readPr(raw: unknown, repoNo: number, repo: string, checks: ChecksState, filesChanged: number | null, nowMs: number): PrRow | null {
  const p = (raw ?? {}) as { number?: unknown; title?: unknown; draft?: unknown; created_at?: unknown; updated_at?: unknown; head?: { ref?: unknown }; changed_files?: unknown };
  if (!prOk(p.number)) return null;
  const files = Number(filesChanged ?? p.changed_files);
  return {
    repo_no: repoNo, repo, pr: p.number, branch: plain(p.head?.ref, 120), title: plain(p.title, 120), draft: p.draft === true,
    age_days: daysSince(p.created_at, nowMs), days_quiet: daysSince(p.updated_at, nowMs), files_changed: Number.isFinite(files) && files >= 0 ? Math.floor(files) : 0, checks,
  };
}

/** Totals over the open pull requests read, all counted here. */
export function prTotals(rows: readonly PrRow[], open: number) {
  return {
    open_prs: open,
    draft_prs: rows.filter((r) => r.draft).length,
    failing_prs: rows.filter((r) => r.checks === "failing").length,
    waiting_prs: rows.filter((r) => !r.draft && r.checks !== "failing").length,
    oldest_pr_days: rows.reduce((n, r) => Math.max(n, r.age_days), 0),
  };
}

/** The file paths one pull request changes, at most MAX_PATHS. Paths are untrusted. */
export function readPaths(j: unknown): string[] {
  return (Array.isArray(j) ? j : []).map((f) => plain((f as { filename?: unknown } | null)?.filename, 300)).filter(Boolean).slice(0, MAX_PATHS);
}

export interface IssueRow { repo_no: number; repo: string; issue: number; title: string; labels: string[]; age_days: number }
/** Open issues from GitHub's list: pull requests (which GitHub lists as issues too) are left out. Titles and labels are untrusted. */
export function readIssues(j: unknown, repoNo: number, repo: string, nowMs: number): IssueRow[] {
  const out: IssueRow[] = [];
  for (const raw of Array.isArray(j) ? j : []) {
    const i = (raw ?? {}) as { number?: unknown; title?: unknown; labels?: unknown; created_at?: unknown; pull_request?: unknown };
    if (i.pull_request || !prOk(i.number)) continue;
    const labels = (Array.isArray(i.labels) ? i.labels : []).map((l) => plain(typeof l === "string" ? l : (l as { name?: unknown } | null)?.name, 40)).filter(Boolean).slice(0, 6);
    out.push({ repo_no: repoNo, repo, issue: i.number, title: plain(i.title, 120), labels, age_days: daysSince(i.created_at, nowMs) });
  }
  return out.slice(0, MAX_ISSUES);
}

/** The repos the installs can see, from GET /installation/repositories: full names only. */
export function readRepoList(j: unknown): { name: string; defaultBranch: string }[] {
  const list = ((j ?? {}) as { repositories?: unknown }).repositories;
  return (Array.isArray(list) ? list : []).map((r) => {
    const x = (r ?? {}) as { full_name?: unknown; default_branch?: unknown };
    return { name: String(x.full_name ?? ""), defaultBranch: plain(x.default_branch, 100) || "main" };
  }).filter((r) => repoOk(r.name));
}

/** The claims of the App's own JWT: issued a minute back for clock drift, good for nine minutes (GitHub allows ten). */
export function appClaims(appId: string, nowMs: number): { iat: number; exp: number; iss: string } {
  const now = Math.floor(nowMs / 1000);
  return { iat: now - 60, exp: now + 540, iss: appId };
}

/** The body asking GitHub for an installation token: only the read permissions and only these repos (names without owner). */
export function tokenRequestBody(repos: readonly string[]): { repositories: string[]; permissions: typeof READ_PERMISSIONS } {
  return { repositories: repos.map((r) => r.split("/")[1]), permissions: READ_PERMISSIONS };
}

/** How long a minted token is reused: GitHub's last an hour; this stops ten minutes short. */
export const TOKEN_REUSE_MS = 50 * 60_000;
