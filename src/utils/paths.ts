/**
 * Path helpers for paths the user types into a prompt (export target, import source).
 *
 * 用户在输入框里敲的路径：去掉首尾引号、展开开头的 `~`（用 os.homedir()，Windows 下也能用），
 * 相对路径按 pi 的工作目录解析。只做字符串处理，不碰文件系统。
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Strip one pair of matching surrounding quotes, as a shell would ("C:\My Files\a.jsonl"). */
export function stripQuotes(value: string): string {
	const first = value[0];
	if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) return value.slice(1, -1);
	return value;
}

/** Expand a leading `~` / `~/` / `~\` to the home directory; anything else is returned unchanged. */
export function expandHome(value: string): string {
	if (value === "~") return homedir();
	if (/^~[\\/]/.test(value)) return join(homedir(), value.slice(2));
	return value;
}

/**
 * Absolute path of what the user typed: trimmed, unquoted, `~` expanded,
 * relative paths resolved against `cwd`. Returns "" for blank input.
 */
export function resolveUserPath(cwd: string, input: string): string {
	const value = stripQuotes(input.trim()).trim();
	if (!value) return "";
	return resolve(cwd, expandHome(value));
}
