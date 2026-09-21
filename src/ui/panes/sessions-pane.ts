/**
 * Sessions pane (left, top).
 *
 * Lists `SessionRow[]`. Each row uses two lines:
 *
 *   › FilmRecall                       09-20 22:18
 *     opus-4 · ~/code/myself/FilmRecall · 128 msgs
 *
 * Static for now: the cursor row is highlighted, but key handling is a later task.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ListScope, SessionRow, SessionSortMode } from "../../types.ts";
import { formatShortDate, shortenPath } from "../../utils/format.ts";
import { fit, frame } from "../frame.ts";

export interface SessionsPaneProps {
	rows: SessionRow[];
	cursor: number;
	focused: boolean;
	scope: ListScope;
	sort: SessionSortMode;
	selected: Set<string>;
	/** Frame title; the panel passes "[1] SESSIONS" so the jump key is visible. */
	title?: string;
	theme: Theme;
}

const ROW_HEIGHT = 2;

export function renderSessionsPane(p: SessionsPaneProps, width: number, height: number): string[] {
	const { theme } = p;
	const inner = width - 2;
	const visibleRows = Math.max(1, Math.floor((height - 2) / ROW_HEIGHT));
	const body: string[] = [];

	if (p.rows.length === 0) {
		body.push(theme.fg("muted", " No sessions found."));
	} else {
		const first = scrollOffset(p.cursor, p.rows.length, visibleRows);
		for (let i = first; i < Math.min(p.rows.length, first + visibleRows); i++) {
			const row = p.rows[i]!;
			const isCursor = i === p.cursor;
			body.push(...renderRow(row, inner, isCursor, p));
		}
	}

	const scopeLabel = p.scope === "all" ? "All" : "Current";
	const meta = p.rows.length ? `${p.cursor + 1}/${p.rows.length} · ${scopeLabel} · ${p.sort}` : scopeLabel;
	return frame(body, {
		width,
		height,
		title: p.title ?? "SESSIONS",
		meta,
		border: (s) => theme.fg(p.focused ? "borderAccent" : "border", s),
		titleStyle: (s) => (p.focused ? theme.bold(theme.fg("accent", s)) : theme.fg("muted", s)),
		metaStyle: (s) => theme.fg("dim", s),
	});
}

function renderRow(row: SessionRow, inner: number, isCursor: boolean, p: SessionsPaneProps): string[] {
	const { theme } = p;
	const indent = "  ".repeat(row.threadDepth ?? 0);
	const marker = isCursor ? "› " : p.selected.has(row.file) ? "• " : "  ";
	const date = formatShortDate(row.updatedAt);
	const title = row.name ?? row.preview ?? "(empty session)";

	// line 1: marker + indent + title ....... date
	const rightW = visibleWidth(date) + 1;
	const titleW = Math.max(1, inner - visibleWidth(marker) - visibleWidth(indent) - rightW);
	const titleText = truncateToWidth(title || "(empty session)", titleW, "…", true);
	const line1Raw = `${marker}${indent}${titleText} ${date}`;

	// line 2: model · cwd · N msgs
	const details = [row.model ?? "", shortenPath(row.cwd), `${row.messageCount} msgs`].filter(Boolean).join(" · ");
	const line2Raw = `  ${indent}${truncateToWidth(details, Math.max(1, inner - 2 - visibleWidth(indent)), "…", false)}`;

	if (isCursor) {
		const hl = (s: string) => theme.bg("selectedBg", fit(s, inner));
		return [
			hl(theme.bold(theme.fg("accent", marker)) + indent + theme.bold(titleText) + " " + theme.fg("dim", date)),
			hl(theme.fg("muted", line2Raw)),
		];
	}
	const markerStyle = p.selected.has(row.file) ? (s: string) => theme.fg("warning", s) : (s: string) => s;
	return [
		fit(markerStyle(marker) + indent + theme.fg("text", titleText) + " " + theme.fg("dim", date), inner),
		fit(theme.fg("muted", line2Raw), inner),
	];
}

/** First visible index so that `cursor` stays inside a window of `visible` rows. */
export function scrollOffset(cursor: number, total: number, visible: number): number {
	if (total <= visible) return 0;
	const half = Math.floor(visible / 2);
	return Math.min(Math.max(0, cursor - half), total - visible);
}
