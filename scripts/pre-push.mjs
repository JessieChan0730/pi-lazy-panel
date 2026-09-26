#!/usr/bin/env node
/**
 * git pre-push hook (.husky/pre-push). Any failed check rejects the push.
 *
 * 检查项的实现都在 scripts/checks.mjs（和 CI 共用），这里只负责：
 *   1. 校验发布约束：release tag（vX.Y.Z）只能打在 main 上，指向非 main 提交就拒绝推送
 *   2. 从 git 传进来的 stdin 里算出「本次推送新增的提交」
 *   3. 据此算出改动过的代码文件
 *   4. 调 runChecks，失败则拒绝 push（`git push --no-verify` 可跳过，不推荐）
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
// 发布 tag：refs/tags/vX（vX.Y.Z）。只约束版本 tag，其它 tag 不管。
const RELEASE_TAG = /^refs\/tags\/v\d/;

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

/** 从 stdin 里挑出本次要推送的发布 tag（refs/tags/vX），返回 tag 名 + 本地 sha。 */
function releaseTagsToPush(stdin) {
	const tags = [];
	for (const line of stdin.split(/\r?\n/)) {
		const [, localSha, remoteRef] = line.trim().split(/\s+/);
		if (!localSha || ZERO_SHA.test(localSha) || !RELEASE_TAG.test(remoteRef ?? "")) continue;
		tags.push({ name: remoteRef.slice("refs/tags/".length), sha: localSha });
	}
	return tags;
}

/** 找一个能用来校验的 main：本地 main 优先，其次 origin/main；都没有返回空串。 */
function resolveMainRef() {
	for (const ref of ["main", "origin/main"]) {
		if (spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: ROOT }).status === 0) return ref;
	}
	return "";
}

/**
 * 发布约束：release tag 只能打在 main 上。
 * tag 指向的 commit 必须是 main（本地或 origin/main）的祖先，否则拒绝推送。
 * 返回 true 表示全部合规。
 */
function assertReleaseTagsOnMain(tags) {
	const mainRef = resolveMainRef();
	if (!mainRef) {
		console.error("  ✗ release guard: 找不到 main 分支，无法校验 release tag，请先 `git fetch origin main`。");
		return false;
	}
	let ok = true;
	for (const tag of tags) {
		// annotated tag 的 sha 指向 tag 对象，^{commit} 解引用到真正的提交
		const commit = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${tag.sha}^{commit}`], { cwd: ROOT, encoding: "utf-8" }).stdout.trim();
		const onMain = commit && spawnSync("git", ["merge-base", "--is-ancestor", commit, mainRef], { cwd: ROOT }).status === 0;
		if (onMain) {
			console.log(`  ✓ release tag ${tag.name} 在 ${mainRef} 上`);
		} else {
			console.error(`  ✗ release tag ${tag.name} 指向的提交不在 ${mainRef} 上；release tag 只能打在 main 分支上。`);
			ok = false;
		}
	}
	return ok;
}

async function main() {
	const [remote = "remote"] = process.argv.slice(2);
	const stdin = await readStdin();

	// 先卡发布约束：即使这次只推 tag（没有新提交），也要拦住打错分支的 release tag
	const tags = releaseTagsToPush(stdin);
	if (tags.length > 0 && !assertReleaseTagsOnMain(tags)) {
		console.error("  (emergency bypass: `git push --no-verify`.)");
		process.exitCode = 1;
		return;
	}

	const commits = commitsToPush(stdin);
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
