#!/usr/bin/env node
/**
 * git pre-push hook (.husky/pre-push). Any failed check rejects the push.
 *
 * 检查项（互不依赖，一起跑、最后汇总，一次看到全部问题）：
 *   1. commit messages  要推送的每个提交都符合约定式提交（commitlint.config.js）
 *   2. eslint           整个项目（eslint.config.js），i18n 那条规则除外
 *   3. i18n text        只查本次推送改动过的代码文件：不许写死非英文文案（i18n/no-hardcoded-text）
 *   4. i18n keys        t() 用到的 key 和 locales/{en,zh}.json 对齐（npm run i18n:check）
 *   5. typecheck        tsc --noEmit（npm run check）
 *   6. tests            全部单元测试（npm test）
 *
 * "要推送的提交" = 本地要推的 sha 能到达、但任何远端分支（和该远端分支当前的位置）都还没有的提交，
 * 所以把已经推过的 main 合并进来不会重复检查老提交。检查跑在工作区上：有没提交的改动时，
 * 结果以工作区为准。紧急情况可以 `git push --no-verify` 跳过（不推荐）。
 *
 * git 调用时：argv = [remote 名, remote URL]，stdin 每行 `<本地 ref> <本地 sha> <远端 ref> <远端 sha>`。
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ZERO_SHA = /^0+$/;
const I18N_RULE = "i18n/no-hardcoded-text";
const CODE_FILE = /\.(ts|mts|cts|js|mjs|cjs)$/;

/** Run git in the repo; returns stdout lines (throws on failure). */
function git(args) {
	const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf-8" });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
	return result.stdout.split(/\r?\n/).filter(Boolean);
}

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

/** Code files touched by `commits` that still exist in the working tree. */
function changedCodeFiles(commits) {
	if (commits.length === 0) return [];
	const files = git(["log", "--no-walk", "--name-only", "--format=", "--diff-filter=ACMR", ...commits]);
	return [...new Set(files)].filter((file) => CODE_FILE.test(file) && existsSync(join(ROOT, file)));
}

/** Run a program to completion, capturing stdout + stderr together. */
function run(command, args, input) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		child.on("error", (error) => resolve({ ok: false, output: `${output}${error.message}\n` }));
		child.on("close", (code) => resolve({ ok: code === 0, output }));
		child.stdin.end(input ?? "");
	});
}

/** `node <args>` with the same node that runs this hook. */
function runNode(args, input) {
	return run(process.execPath, args, input);
}

async function checkCommitMessages(commits) {
	const cli = require.resolve("@commitlint/cli/cli.js");
	const reports = await Promise.all(
		commits.map(async (sha) => {
			const [subject] = git(["log", "-1", "--format=%s", sha]);
			const message = spawnSync("git", ["log", "-1", "--format=%B", sha], { cwd: ROOT, encoding: "utf-8" }).stdout;
			const result = await runNode([cli], message);
			return { ok: result.ok, text: result.ok ? "" : `${sha.slice(0, 7)} ${subject}\n${result.output.trim()}\n` };
		}),
	);
	const bad = reports.filter((r) => !r.ok);
	return {
		ok: bad.length === 0,
		output: bad.map((r) => r.text).join("\n"),
		note: `${commits.length} commit(s)`,
	};
}

/** ESLint through its API, so the i18n rule can be split off and run on the changed files only. */
async function lint(files, ruleFilter) {
	const eslint = new ESLint({ cwd: ROOT, ruleFilter, warnIgnored: false, errorOnUnmatchedPattern: false });
	const results = await eslint.lintFiles(files);
	const problems = results.reduce((n, r) => n + r.errorCount + r.warningCount, 0);
	const formatter = await eslint.loadFormatter("stylish");
	return { ok: problems === 0, output: await formatter.format(results), note: problems ? `${problems} problem(s)` : "" };
}

async function checkI18nText(files) {
	if (files.length === 0) return { ok: true, output: "", note: "no code files changed" };
	const result = await lint(files, ({ ruleId }) => ruleId === I18N_RULE);
	return { ...result, note: result.note || `${files.length} changed file(s)` };
}

const CHECKS = [
	["commit messages", ({ commits }) => checkCommitMessages(commits)],
	["eslint", () => lint(["."], ({ ruleId }) => ruleId !== I18N_RULE)],
	["i18n text", ({ files }) => checkI18nText(files)],
	["i18n keys", () => runNode([join("scripts", "i18n-scan.mjs"), "--check"])],
	["typecheck", () => runNode([require.resolve("typescript/bin/tsc"), "--noEmit"])],
	["tests", () => runNode(["--import", "tsx", "--test", "--test-reporter=dot", "test/**/*.test.ts"])],
];

async function main() {
	const [remote = "remote"] = process.argv.slice(2);
	const commits = commitsToPush(await readStdin());
	if (commits.length === 0) {
		console.log("pre-push: no new commits to check.");
		return;
	}
	const files = changedCodeFiles(commits);
	console.log(`pre-push: checking ${commits.length} commit(s) before pushing to ${remote} …`);

	// 各项检查同时跑（ESLint 在本进程，其余是子进程），按固定顺序打印结果
	const started = Date.now();
	const results = await Promise.all(
		CHECKS.map(async ([name, check]) => {
			const t0 = Date.now();
			try {
				return { name, ...(await check({ commits, files })), ms: Date.now() - t0 };
			} catch (err) {
				return { name, ok: false, output: `${err instanceof Error ? err.stack : err}\n`, ms: Date.now() - t0 };
			}
		}),
	);

	for (const r of results.filter((r) => !r.ok)) {
		console.log(`\n── ${r.name} ${"─".repeat(Math.max(0, 60 - r.name.length))}\n${r.output.trim()}`);
	}
	console.log("");
	for (const r of results) {
		const note = r.note ? `  (${r.note})` : "";
		console.log(`  ${r.ok ? "✓" : "✗"} ${r.name.padEnd(16)} ${(r.ms / 1000).toFixed(1).padStart(5)}s${note}`);
	}
	const failed = results.filter((r) => !r.ok);
	if (failed.length) {
		console.error(`\n✗ push rejected: ${failed.map((r) => r.name).join(", ")} failed. Fix them and push again.`);
		if (failed.some((r) => r.name === "commit messages")) {
			console.error("  Reword commits with `git commit --amend` (last one) or `git rebase -i` (earlier ones).");
		}
		process.exitCode = 1;
		return;
	}
	console.log(`\n✓ all checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

await main();
