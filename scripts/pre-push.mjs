#!/usr/bin/env node
/**
 * git pre-push hook (.husky/pre-push). Any failed check rejects the push.
 *
 * 检查项的实现都在 scripts/checks.mjs（和 CI 共用），这里只负责：
 *   1. 从 git 传进来的 stdin 里算出「本次推送新增的提交」
 *   2. 据此算出改动过的代码文件
 *   3. 调 runChecks，失败则拒绝 push（`git push --no-verify` 可跳过，不推荐）
 *
 * "要推送的提交" = 本地要推的 sha 能到达、但任何远端分支（和该远端分支当前的位置）都还没有的提交，
 * 所以把已经推过的 main 合并进来不会重复检查老提交。检查跑在工作区上：有没提交的改动时，
 * 结果以工作区为准。
 *
 * git 调用时：argv = [remote 名, remote URL]，stdin 每行 `<本地 ref> <本地 sha> <远端 ref> <远端 sha>`。
 */

import { spawnSync } from "node:child_process";
import { changedCodeFiles, git, ROOT, runChecks } from "./checks.mjs";

const ZERO_SHA = /^0+$/;

/** Whole stdin as text (git pipes the ref updates in). */
async function readStdin() {
	if (process.stdin.isTTY) return "";
	let text = "";
	for await (const chunk of process.stdin) text += chunk;
	return text;
}

/** Commits the push would add to the remote, oldest first. */
function commitsToPush(stdin) {
	const commits = new Set();
	for (const line of stdin.split(/\r?\n/)) {
		const [, localSha, , remoteSha] = line.trim().split(/\s+/);
		// 删除远端分支时本地 sha 全是 0，没有要检查的内容
		if (!localSha || ZERO_SHA.test(localSha)) continue;
		const args = ["rev-list", "--reverse", localSha, "--not", "--remotes"];
		// 远端分支已存在且本地认识它当前的 sha：它能到达的提交也排除掉
		if (remoteSha && !ZERO_SHA.test(remoteSha) && spawnSync("git", ["cat-file", "-e", `${remoteSha}^{commit}`], { cwd: ROOT }).status === 0) {
			args.push(remoteSha);
		}
		for (const sha of git(args)) commits.add(sha);
	}
	return [...commits];
}

async function main() {
	const [remote = "remote"] = process.argv.slice(2);
	const commits = commitsToPush(await readStdin());
	if (commits.length === 0) {
		console.log("pre-push: no new commits to check.");
		return;
	}
	const files = changedCodeFiles(commits);
	console.log(`pre-push: checking ${commits.length} commit(s) before pushing to ${remote} …`);

	const ok = await runChecks({ commits, files });
	if (!ok) {
		console.error("  (emergency bypass: `git push --no-verify`.)");
		process.exitCode = 1;
	}
}

await main();
