/**
 * Pinned-sessions store.
 *
 * Reads / writes `~/.pi/agent/lazy-panel-pins.json`, the ordered list of
 * session files the user pinned with `p`. Only this module knows where the
 * file lives. The array is display order: the first entry is shown at the very
 * top of the sessions pane (newest pin first), unaffected by the sort mode.
 *
 * 置顶不写进会话的 .jsonl（条目只能追加、克隆会被复制），也不写进用户手改的
 * lazy-panel.json（会打乱格式），单独放一个文件。数组顺序即显示顺序：越靠前越
 * 靠上（最后置顶的在最前），排序模式不影响它。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PINS_FILE_NAME } from "../constants.ts";

/** On-disk shape; wrapped in an object so the format can grow later. */
interface PinsFile {
	pinned: string[];
}

/**
 * Load the pinned session files (display order). A missing or broken file
 * yields an empty list — pins are a convenience, never fatal.
 */
export function loadPins(agentDir: string): string[] {
	let raw: string;
	try {
		raw = readFileSync(join(agentDir, PINS_FILE_NAME), "utf8");
	} catch {
		return [];
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		// 兼容裸数组和 { pinned: [...] } 两种写法。
		const list = Array.isArray(parsed) ? parsed : (parsed as PinsFile | null)?.pinned;
		if (!Array.isArray(list)) return [];
		return dedupe(list.filter((f): f is string => typeof f === "string" && f.length > 0));
	} catch {
		return [];
	}
}

/** Persist the pinned session files (display order). Throws on write failure. */
export function savePins(agentDir: string, pinned: string[]): void {
	const file: PinsFile = { pinned: dedupe(pinned) };
	writeFileSync(join(agentDir, PINS_FILE_NAME), `${JSON.stringify(file, null, 2)}\n`);
}

/** Drop duplicate paths, keeping the first occurrence (its display position). */
function dedupe(files: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const f of files) {
		if (seen.has(f)) continue;
		seen.add(f);
		out.push(f);
	}
	return out;
}
