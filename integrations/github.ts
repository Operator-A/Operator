import "server-only";
// GitHub, reads (engineering isolation slice 1, docs/engineering.md). Calls our own GitHub server through
// integrations/mcp.ts, over the repos the owner turned on on Connections. There is no write: OPERATOR never
// pushes, opens or merges anything in GitHub.
import { callMcpTool } from "./mcp";
import type { ChecksState, IssueRow, PrRow } from "@/core/github-rules";

type RepoNo = { repo_no: number; repo: string };

export const githubOpenPrs = async () =>
  (await callMcpTool("github", "github_open_prs", {})) as { repos: RepoNo[]; prs: PrRow[]; totals: Record<string, number>; truncated: boolean };

export const githubPrFiles = async (repo: number, pr: number) =>
  (await callMcpTool("github", "github_pr_files", { repo, pr })) as { repo_no: number; repo: string; pr: number; branch: string; title: string; open: boolean; files_changed: number; paths: string[]; truncated: boolean };

export const githubOpenIssues = async () =>
  (await callMcpTool("github", "github_open_issues", {})) as { repos: RepoNo[]; issues: IssueRow[]; totals: Record<string, number> };

export const githubChecks = async () =>
  (await callMcpTool("github", "github_checks", {})) as { repos: (RepoNo & { branch: string; state: ChecksState; passed: number; failed: number; pending: number; failing: string[] })[]; totals: Record<string, number> };
