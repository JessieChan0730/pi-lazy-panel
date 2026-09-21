/**
 * Small formatting helpers shared by the UI layer (dates, token counts, cost,
 * path shortening). Pure functions only.
 */

import { homedir } from "node:os";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/** "22:18" style time for tree rows. */
export function formatTime(timestamp: number): string {
	const d = new Date(timestamp);
	if (Number.isNaN(d.getTime())) return "--:--";
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "Sep 20 22:18" style for dialogs. */
export function formatDateTime(timestamp: number): string {
	const d = new Date(timestamp);
	if (Number.isNaN(d.getTime())) return "";
	return `${MONTHS[d.getMonth()]} ${d.getDate()} ${formatTime(timestamp)}`;
}

/** "09-20 22:18" — compact form used by the sessions pane. */
export function formatShortDate(timestamp: number): string {
	const d = new Date(timestamp);
	if (Number.isNaN(d.getTime())) return "";
	return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${formatTime(timestamp)}`;
}

/** 84213 -> "84.2k" */
export function formatTokens(tokens: number): string {
	if (!Number.isFinite(tokens) || tokens < 0) return "0";
	if (tokens < 1000) return String(Math.round(tokens));
	if (tokens < 1_000_000) return `${trimZero((tokens / 1000).toFixed(1))}k`;
	return `${trimZero((tokens / 1_000_000).toFixed(1))}M`;
}

function trimZero(s: string): string {
	return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** 1.4211 -> "$1.42" */
export function formatCost(usd: number): string {
	if (!Number.isFinite(usd)) return "$0.00";
	return `$${usd.toFixed(2)}`;
}

/**
 * Replace the home directory prefix with "~".
 *
 * 跨平台：Windows 下 homedir() 是 `C:\Users\xxx`，pi 存的 cwd 也用 `\`；
 * 但同一台机器上也可能出现 `/`（git bash、手写路径），所以两种分隔符都认。
 * Windows 盘符大小写不敏感，比较前缀时忽略大小写。
 */
export function shortenPath(path: string): string {
	const home = homedir();
	if (!home) return path;
	const isWin = process.platform === "win32";
	const norm = (s: string) => (isWin ? s.toLowerCase() : s);
	if (norm(path) !== norm(home) && !norm(path).startsWith(norm(home) + "/") && !norm(path).startsWith(norm(home) + "\\")) {
		return path;
	}
	return `~${path.slice(home.length)}`;
}

/** Collapse whitespace/newlines so a piece of text fits on one line. */
export function singleLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * `\r\n` / 孤立 `\r` 统一成 `\n`。
 * 实测 pi 在 Windows 上写的 .jsonl 本身不带 `\r`，但工具输出、粘贴内容可能带；
 * 残留的 `\r` 会让 split("\n") 后的行尾多一个不可见字符，影响宽度计算和渲染。
 */
export function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}
