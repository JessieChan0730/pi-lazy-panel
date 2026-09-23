/**
 * pi's changelog, as `/changelog` shows it.
 *
 * pi reads `CHANGELOG.md` from its package directory, cuts it into one entry
 * per `## [x.y.z]` heading and prints every entry. The parser
 * (`utils/changelog.js`) is not exported by the package, so it is copied here;
 * `getPackageDir` is exported and points at the running pi's install.
 *
 * 和 pi 内置 /changelog 读同一个文件、同样的切分规则；pi 的 parseChangelog 没有导出，这里照搬。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

/** What pi prints when the file has no entries. */
export const NO_CHANGELOG = "No changelog entries found.";

/** Path of the running pi's CHANGELOG.md. */
export function changelogPath(): string {
	return path.resolve(path.join(getPackageDir(), "CHANGELOG.md"));
}

/**
 * Split changelog markdown into its version entries, in file order. Like pi:
 * a `## ` line starts an entry when it carries a version (`## [0.86.1] - …`),
 * text under a `## ` line without one (e.g. `## [Unreleased]`) is skipped.
 */
export function parseChangelog(markdown: string): string[] {
	const entries: string[] = [];
	let current: string[] | undefined;
	const flush = () => {
		if (current && current.length > 0) entries.push(current.join("\n").trim());
	};
	for (const line of markdown.split(/\r?\n/)) {
		if (line.startsWith("## ")) {
			flush();
			current = /##\s+\[?(\d+)\.(\d+)\.(\d+)\]?/.test(line) ? [line] : undefined;
		} else if (current) {
			current.push(line);
		}
	}
	flush();
	return entries;
}

/**
 * The markdown the dialog renders: every entry, or pi's "no entries" line.
 * The file lists the newest version first; pi reverses it because its chat
 * shows the bottom, the dialog opens at the top so it keeps the newest first.
 *
 * 和 pi 的一个差异：pi 倒序（最新的在最下面，聊天区看的是底部），弹窗从顶部开始看，所以保持文件顺序、最新的在最上面。
 */
export function changelogMarkdown(markdown: string): string {
	const entries = parseChangelog(markdown);
	return entries.length > 0 ? entries.join("\n\n") : NO_CHANGELOG;
}

/** Read the running pi's changelog (a missing file reads as "no entries", like pi). */
export async function loadChangelog(file: string = changelogPath()): Promise<string> {
	if (!existsSync(file)) return NO_CHANGELOG;
	return changelogMarkdown(readFileSync(file, "utf-8"));
}
