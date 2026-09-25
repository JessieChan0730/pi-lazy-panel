#!/usr/bin/env node
/**
 * npm `prepare` hook: install the git hooks in .husky/ (pre-push, commit-msg).
 *
 * 只在开发仓库里装 hooks。pi 从 git 安装插件时跑的是 `npm install --omit=dev`，那时没有 husky，
 * 这里必须静默跳过、不能让安装失败；不在 git 仓库里时 husky 自己会跳过（只打印一句说明）。
 */

async function main() {
	let husky;
	try {
		({ default: husky } = await import("husky"));
	} catch {
		return;
	}
	const message = husky();
	if (message) console.log(message);
}

await main();
