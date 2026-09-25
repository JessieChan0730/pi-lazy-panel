#!/usr/bin/env node
/**
 * CI 入口（.github/workflows/ci.yml）。和 pre-push 跑同一套检查（scripts/checks.mjs），
 * 只是「要检查的提交 / 改动过的代码文件」从 PR 的 base..head 算，而不是 git pre-push 的 stdin。
 *
 * 环境变量（由 workflow 注入）：
 *   PR_BASE_SHA / PR_HEAD_SHA  PR 的基点和头部；两个都在时算 base..head 之间的提交和改动文件。
 *
 * 两个都没有时（push / 手动触发）commits / files 为空：commit messages 与 i18n text 自然跳过
 * （没有要查的提交 / 文件），其余（eslint / i18n keys / typecheck / tests）照常整项目跑。
 */

import { changedCodeFiles, git, runChecks } from "./checks.mjs";

/** PR 里 base..head 之间的提交，oldest first。 */
function prCommits(base, head) {
	return git(["rev-list", "--reverse", `${base}..${head}`]);
}

async function main() {
	const base = process.env.PR_BASE_SHA;
	const head = process.env.PR_HEAD_SHA;

	let commits = [];
	if (base && head) {
		commits = prCommits(base, head);
		console.log(`ci: checking ${commits.length} commit(s) in ${base.slice(0, 7)}..${head.slice(0, 7)} …`);
	} else {
		console.log("ci: no PR range given; running project-wide checks (commit messages / i18n text skipped).");
	}
	const files = changedCodeFiles(commits);

	const ok = await runChecks({ commits, files });
	if (!ok) process.exitCode = 1;
}

await main();
