/**
 * Raw-key dump — a temporary aid for "what does this terminal actually send
 * for that key?" questions.
 *
 * Start pi with LAZY_PANEL_KEY_LOG=<path to a file>: while the panel is open,
 * every raw input chunk the terminal delivers is appended to that file as one
 * line (`<time>\t<json escaped chunk>\t<chord or ->`), and the panel still gets
 * the key as usual. It answers the questions static reading cannot — what herdr
 * sends for F1, whether Delete arrives as `\x1b[57349u` or legacy `\x1b[3~`,
 * whether a lone Ctrl reaches the app at all. See docs/issues.md.
 *
 * 原始按键 dump：排查“某个键在某终端里到底发了什么”的临时工具。
 * 设 `LAZY_PANEL_KEY_LOG=<文件路径>` 启动 pi，面板打开期间每个原始输入块都追加一行
 * （时间 / JSON 转义后的原始字节 / 解析出的 chord，`-` 表示认不出），按键照常交给面板。
 * 没设环境变量时（平时）返回 undefined，什么都不做。
 */

import { appendFileSync } from "node:fs";
import { chordFromKeypress } from "../config/keys.ts";

/** Just enough of pi-tui's TUI for the key log (same shape as `MouseHost`). */
export interface KeyLogHost {
	addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined): () => void;
}

/**
 * Append every raw key chunk to `path` (defaults to `LAZY_PANEL_KEY_LOG`).
 * Returns the cleanup function, or undefined when no path is configured.
 */
export function attachKeyLog(host: KeyLogHost, path = process.env.LAZY_PANEL_KEY_LOG): (() => void) | undefined {
	if (!path)
		return undefined;
	return host.addInputListener((data) => {
		try {
			appendFileSync(path, `${new Date().toISOString()}\t${JSON.stringify(data)}\t${chordFromKeypress(data) ?? "-"}\n`);
		} catch {
			// 写不进去（路径不存在等）不该影响面板，静默忽略。
		}
		// 不 consume：按键仍然照常流给面板。
		return undefined;
	});
}
