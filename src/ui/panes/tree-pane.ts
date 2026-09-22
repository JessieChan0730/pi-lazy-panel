/**
 * Tree pane (left, bottom).
 *
 * Lists `TreeRow[]` of the session highlighted in the sessions pane, one line
 * per entry with pi-style guide lines (see ../tree-lines.ts):
 *
 *   ›    • 22:18 [system]
 *     ├⊟ 22:18 user: hi
 *     │     [label] 22:19 assistant: Hi! I'm ready to help with ...
 *     └⊟ • 22:20 user: hi
 *          • 22:20 assistant: …
 *
 * The pane is narrow, so only the innermost MAX_LEVELS levels of a deep tree
 * are drawn and the rest is folded into `… `. The full tree, with search and
 * filters, lives in the tree dialog (`a`, ../widgets/tree-dialog.ts); this
 * pane renders whatever rows it is given. The cursor is highlighted, nodes off
 * the active branch are dimmed.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TreeRow } from "../../types.ts";
import { formatTime } from "../../utils/format.ts";
import { fit, frame } from "../frame.ts";
import { capPrefix, treePrefixes } from "../tree-lines.ts";
import { scrollOffset } from "./sessions-pane.ts";

/** Guide-line levels kept in the narrow pane before folding into `… `. */
export const MAX_LEVELS = 3;

export interface TreePaneProps {
	rows: TreeRow[];
	cursor: number;
	focused: boolean;
	/** Shown when no session is selected / loading. */
	emptyMessage?: string;
	/** Frame title; the panel passes "[2] TREE" so the jump key is visible. */
	title?: string;
	theme: Theme;
}

export function renderTreePane(p: TreePaneProps, width: number, height: number): string[] {
	const { theme } = p;
	const inner = width - 2;
	const visible = Math.max(1, height - 2);
	const body: string[] = [];

	if (p.rows.length === 0) {
		body.push(theme.fg("muted", ` ${p.emptyMessage ?? "No entries."}`));
	} else {
		const prefixes = treePrefixes(p.rows);
		const first = scrollOffset(p.cursor, p.rows.length, visible);
		for (let i = first; i < Math.min(p.rows.length, first + visible); i++) {
			body.push(renderTreeRow(p.rows[i]!, capPrefix(prefixes[i]!, MAX_LEVELS), inner, i === p.cursor, theme));
		}
	}

	const meta = p.rows.length ? `${p.cursor + 1}/${p.rows.length}` : "";
	return frame(body, {
		width,
		height,
		title: p.title ?? "TREE",
		...(meta ? { meta } : {}),
		border: (s) => theme.fg(p.focused ? "borderAccent" : "border", s),
		titleStyle: (s) => (p.focused ? theme.bold(theme.fg("accent", s)) : theme.fg("muted", s)),
		metaStyle: (s) => theme.fg("dim", s),
	});
}

/**
 * One tree line, laid out like pi's /tree: `› ` cursor marker, guide-line
 * prefix, `• ` on the active path, `[label]`, time, `role: ` (omitted for
 * system rows whose text already is a `[system]`-style tag) and the text
 * truncated to what is left. Shared with the tree dialog.
 */
export function renderTreeRow(row: TreeRow, prefix: string, inner: number, isCursor: boolean, theme: Theme): string {
	const marker = isCursor ? "› " : "  ";
	// 和 pi 一样，活动路径上的节点在文字前加 `• `。
	const path = row.onActiveBranch ? "• " : "";
	const label = row.label ? `[${row.label}] ` : "";
	const time = `${formatTime(row.timestamp)} `;
	const role = row.role === "system" ? "" : `${row.role}: `;
	const prefixW =
		visibleWidth(marker) + visibleWidth(prefix) + visibleWidth(path) + visibleWidth(label) + visibleWidth(time) + visibleWidth(role);
	const text = truncateToWidth(row.text, Math.max(1, inner - prefixW), "…", false);

	const roleStyle = (s: string) =>
		row.role === "user"
			? theme.fg("userMessageText", s)
			: row.role === "assistant"
				? theme.fg("accent", s)
				: theme.fg("muted", s);
	const branchStyle = (s: string) => (row.onActiveBranch ? s : theme.fg("dim", s));
	// system 行（[system] / [branch summary]: …）整行用 muted，和 pi 的 dim 标签一致。
	const textStyle = (s: string) => (row.role === "system" ? theme.fg("muted", s) : branchStyle(s));

	const line =
		theme.fg("accent", marker) +
		theme.fg("dim", prefix) +
		theme.fg("accent", path) +
		theme.fg("warning", label) +
		theme.fg("dim", time) +
		branchStyle(roleStyle(role)) +
		textStyle(text);
	return isCursor ? theme.bg("selectedBg", fit(line, inner)) : fit(line, inner);
}
