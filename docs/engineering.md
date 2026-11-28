# Engineering isolation

How engineering agents work on a business's code without OPERATOR ever changing it. Decided 2026-11-28, in
three slices:

1. **GitHub reads** (this page, built): a read-only GitHub connector on OPERATOR's GitHub App, with a repo
   picker on Connections and four read tools.
2. **A branch per run and one open pull request per agent** (to build): an agent's repo and `max_open_prs`
   (default 1, at most 3), a work line in the fire's note naming the branch `operator/<agent id>/<first 8 of
   the run id>`, and a skipped fire when the agent is at its limit.
3. **The run knows its pull request** (to build): `finish_run` takes a `pr`, refused unless it comes from the
   run's own branch, and the run page shows it.

OPERATOR never pushes, opens or merges anything in GitHub. Agents that run in Claude push and open pull
requests from their own session, outside OPERATOR; branch protection on each repo's default branch is the
lock that keeps anything from merging without the owner's review.

## Slice 1: GitHub reads

### What an agent can read

Only the repos the owner turned on on Connections (at most `MAX_REPOS`, five), never a repo a model typed:

| Tool | What it returns |
| --- | --- |
| `github_open_prs` | Open pull requests per repo (at most 10 each): repo number, branch, title, draft, days open, days quiet, files changed, checks state; totals counted in code. |
| `github_pr_files` | The paths one pull request changes (at most 50). The repo is a number from `github_open_prs`. |
| `github_open_issues` | Open issues per repo (at most 20 each): number, title, labels, days open. Pull requests left out. |
| `github_checks` | Check results on each repo's default branch: passing, failing, pending, and the failing names. |

Titles, branch names, labels, paths and check names were written by people, so they are untrusted data,
cut short and cleaned of control characters (`core/github-rules.ts`). No reply chooses a recipient, URL,
product or category.

### How it signs in

- **The profile** (`core/mcp-rules.ts`, `github`): auth `github`, the four read tools, no write tool, no
  report tool, no gateway action type.
- **Connect** is GitHub's web sign-in for OPERATOR's GitHub App (state and PKCE). The person's token is used
  once, to list the App's installations they can reach (`GET /user/installations`), so an installation id
  is never taken from a URL. Every installation's permissions must fit `READ_PERMISSIONS` (pull requests,
  checks, issues and metadata, all read) or the sign-in is refused. The person's token is then cancelled at
  GitHub. The vault keeps only the installations (id and account).
- **No install yet**: Connect goes on to the App's install page on GitHub; the App's Setup URL brings the
  owner back through Connect.
- **Each call** mints a one-hour installation token with the App's JWT (`GITHUB_APP_ID`,
  `GITHUB_APP_PRIVATE_KEY`), narrowed to `READ_PERMISSIONS` and to the picked repos of that account. GitHub's
  answer lists what the token may do; anything more than read refuses it. Tokens are reused for 50 minutes,
  in memory only, never stored.
- **Pauses**: an install GitHub no longer has, or a token carrying more than read, pauses GitHub until the
  owner taps Connect again. A rejected App key does not pause any business: it is the app's own setup.
- **Disconnect** forgets the installs. OPERATOR keeps no GitHub sign-in, so the owner uninstalls the App in
  GitHub to remove it there too.

Our own server (`integrations/github-server.ts`) is the only file that calls GitHub's API, and only
`integrations/mcp.ts` reaches it (lint, `check:mcp`, `check:github`). Its only calls that aren't reads are
minting a token and cancelling the person's sign-in.

### Connections

The GitHub detail shows the install, the repos agents may read (turn on or off; only a repo the App can see
right now can be turned on), the agents with a GitHub read, and the branch protection note. GitHub counts as
set up once at least one repo is on. Turning a repo on grants no agent anything: an approver gives an agent
its GitHub reads on its sheet.

### Setting up OPERATOR's GitHub App (self-host)

1. On GitHub, open Settings, Developer settings, GitHub Apps, New GitHub App.
2. Name it, set the Homepage URL to the app's address, and the Callback URL to
   `https://<app>/connections/github/callback`. Leave "Expire user authorization tokens" on.
3. Setup URL: `https://<app>/connections/github/connect`, with "Redirect on update" ticked.
4. Webhook: untick Active.
5. Repository permissions: Pull requests Read-only, Checks Read-only, Issues Read-only (Metadata is
   Read-only by default). Nothing else.
6. Where can this app be installed: Any account if other businesses will use it.
7. Create the App. On its page copy the App ID and Client ID, generate a client secret, and generate a
   private key (a .pem file).
8. In Vercel set `GITHUB_APP_ID`, `GITHUB_APP_SLUG` (the name in the App's public link,
   `github.com/apps/<slug>`), `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and
   `GITHUB_APP_PRIVATE_KEY` (the .pem file's whole text), then redeploy.

Tests: `npm run check:github`.
