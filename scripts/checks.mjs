#!/usr/bin/env node
/**
 * 共享的检查实现，供 pre-push 钩子（scripts/pre-push.mjs）和 CI（scripts/ci-check.mjs）复用。
 *
 * 六项检查（互不依赖，一起跑、最后汇总，一次看到全部问题）：
 *   1. commit messages  给定的每个提交都符合约定式提交（commitlint.config.js）
 *   2. eslint           整个项目（eslint.config.js），i18n 那条规则除外
 *   3. i18n text        只查改动过的代码文件：不许写死非英文文案（i18n/no-hardcoded-text）
 *   4. i18n keys        t() 用到的 key 和 locales/{en,zh}.json 对齐（scripts/i18n-scan.mjs --check）
 *   5. typecheck        tsc --noEmit
 *   6. tests            全部单元测试
 *
 * 两个入口各自算出「要检查的提交」和「改动的代码文件」后调用 runChecks：
 *   - pre-push 从 git 传进来的 stdin 里算「本次推送新增的提交」
 *   - CI 从 PR 的 base..head 算
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const I18N_RULE = "i18n/no-hardcoded-text";
const CODE_FILE = /\.(ts|mts|cts|js|mjs|cjs)$/;

/** Run git in the repo; returns stdout lines (throws on failure). */
export function git(args) {
	const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf-8" });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
	return result.stdout.split(/\r?\n/).filter(Boolean);
}

/** Code files touched by `commits` that still exist in the working tree. */
export function changedCodeFiles(commits) {
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

/** `node <args>` with the same node that runs this script. */
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

/**
 * 并行跑六项检查，按固定顺序打印失败详情 + 汇总表，返回是否全部通过。
 * 调用方（pre-push / ci）负责根据返回值设置退出码，并打印各自特有的补救提示。
 */
export async function runChecks({ commits = [], files = [] }) {
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
		console.error(`\n✗ ${failed.map((r) => r.name).join(", ")} failed.`);
		if (failed.some((r) => r.name === "commit messages")) {
			console.error("  Reword commits with `git commit --amend` (last one) or `git rebase -i` (earlier ones).");
		}
		return false;
	}
	console.log(`\n✓ all checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
	return true;
}
