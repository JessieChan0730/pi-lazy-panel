/**
 * Tree pane (left, bottom).
 *
 * Lists `TreeRow[]` of the session highlighted in the sessions pane, one line
 * per entry:
 *
 *      user: hi
 *   › [label] 22:18 assistant: Hi! I'm ready to help with ...
 *
 * Static for now: cursor highlight only; filters/labels/restore come later.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TreeFilter, TreeRow } from "../../types.ts";
import { formatTime } from "../../utils/format.ts";
import { fit, frame } from "../frame.ts";
import { scrollOffset } from "./sessions-pane.ts";

export interface TreePaneProps {
	rows: TreeRow[];
	cursor: number;
	focused: boolean;
	filter: TreeFilter;
	/** Shown when no session is selected / loading. */
	emptyMessage?: string;
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
		const first = scrollOffset(p.cursor, p.rows.length, visible);
		for (let i = first; i < Math.min(p.rows.length, first + visible); i++) {
			body.push(renderRow(p.rows[i]!, inner, i === p.cursor, theme));
		}
	}

	const meta = p.rows.length ? `${p.cursor + 1}/${p.rows.length} · ${p.filter}` : p.filter;
	return frame(body, {
		width,
		height,
		title: "TREE",
		meta,
		border: (s) => theme.fg(p.focused ? "borderAccent" : "border", s),
		titleStyle: (s) => (p.focused ? theme.bold(theme.fg("accent", s)) : theme.fg("muted", s)),
		metaStyle: (s) => theme.fg("dim", s),
	});
}

function renderRow(row: TreeRow, inner: number, isCursor: boolean, theme: Theme): string {
	const marker = isCursor ? "› " : row.onActiveBranch ? "  " : "  ";
	const indent = " ".repeat(Math.min(row.depth, 8));
	const label = row.label ? `[${row.label}] ` : "";
	const time = `${formatTime(row.timestamp)} `;
	const role = `${row.role}: `;
	const prefixW = visibleWidth(marker) + visibleWidth(indent) + visibleWidth(label) + visibleWidth(time) + visibleWidth(role);
	const text = truncateToWidth(row.text, Math.max(1, inner - prefixW), "…", false);

	const roleStyle = (s: string) =>
		row.role === "user"
			? theme.fg("userMessageText", s)
			: row.role === "assistant"
				? theme.fg("accent", s)
				: theme.fg("muted", s);
	const branchStyle = (s: string) => (row.onActiveBranch ? s : theme.fg("dim", s));

	const line =
		theme.fg("accent", marker) +
		indent +
		theme.fg("warning", label) +
		theme.fg("dim", time) +
		branchStyle(roleStyle(role)) +
		branchStyle(text);
	return isCursor ? theme.bg("selectedBg", fit(line, inner)) : fit(line, inner);
}
