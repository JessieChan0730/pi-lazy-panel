/**
 * Sessions pane (left, top).
 *
 * Lists `SessionRow[]`. Each row uses two lines:
 *
 *   › FilmRecall                       09-20 22:18
 *     opus-4 · ~/code/myself/FilmRecall · 128 msgs
 *
 * The cursor row is highlighted; sessions picked with space have no marker glyph
 * — their title is tinted accent so selected rows stand out in a long list — and
 * the header starts with "3 selected". While a `/` search is active in the pane the
 * matching rows get their hits painted (see ../search-highlight.ts) and the
 * header counts them ("2/7 matches"); the list itself is never filtered.
 */

import { resolve } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { t } from "../../i18n/index.ts";
import type { ListScope, SearchView, SessionRow, SessionSortMode } from "../../types.ts";
import { formatShortDate, shortenPath } from "../../utils/format.ts";
import { fit, frame, metaBudget } from "../frame.ts";
import { highlightLine, matchStyle, searchMeta } from "../search-highlight.ts";

export interface SessionsPaneProps {
	rows: SessionRow[];
	cursor: number;
	/** First visible row; defaults to a cursor-centered window when omitted (keyboard). */
	first?: number;
	focused: boolean;
	scope: ListScope;
	sort: SessionSortMode;
	selected: Set<string>;
	/** File pi currently has open, if any: that row's title gets a "current" tag (it is the one `d` refuses). */
	currentFile?: string;
	/** Active `/` search of this pane: matching rows are highlighted, the header shows the count. */
	search?: SearchView;
	/** Frame title; the panel passes "[1] SESSIONS" so the jump key is visible. */
	title?: string;
	theme: Theme;
}

/** Each session takes two lines; the tree / mouse hit-test share this constant. */
export const SESSIONS_ROW_HEIGHT = 2;

export function renderSessionsPane(p: SessionsPaneProps, width: number, height: number): string[] {
	const { theme } = p;
	const inner = width - 2;
	const visibleRows = Math.max(1, Math.floor((height - 2) / SESSIONS_ROW_HEIGHT));
	const body: string[] = [];

	if (p.rows.length === 0) {
		body.push(theme.fg("muted", ` ${t("pane.sessionsEmpty")}`));
	} else {
		// pi 当前打开的会话（比较解析后的路径，和 findSessionIndex 一致）：这一行会带 current 标记。
		const currentResolved = p.currentFile ? resolve(p.currentFile) : undefined;
		// 滚轮滚动时用给定的 first（不动光标）；否则按光标居中。
		const first = clampFirst(p.first ?? scrollOffset(p.cursor, p.rows.length, visibleRows), p.rows.length, visibleRows);
		for (let i = first; i < Math.min(p.rows.length, first + visibleRows); i++) {
			const row = p.rows[i]!;
			const isCursor = i === p.cursor;
			const isCurrent = currentResolved !== undefined && resolve(row.file) === currentResolved;
			const lines = renderRow(row, inner, isCursor, isCurrent, p);
			// 搜索命中的行：两行里出现的关键词都加高亮，光标所在的当前匹配再加强调。
			const search = p.search;
			if (search?.matches.has(i)) {
				const style = matchStyle(theme, i === search.current);
				body.push(...lines.map((l) => highlightLine(l, search.terms, style)));
			} else {
				body.push(...lines);
			}
		}
	}

	const title = p.title ?? "SESSIONS";
	const budget = metaBudget(width, title);
	const selected = selectedMeta(p.selected.size);
	const rest = Math.max(0, budget - (selected ? visibleWidth(selected) + 3 : 0));
	const base = p.search ? searchMeta(p.search.position, p.search.total, rest) : sessionsMeta(p.rows.length, p.cursor, p.scope, p.sort, rest);
	// 有多选时标题右侧先显示 "3 selected"，剩下的空间再放位置 / 搜索计数。
	const meta = selected && visibleWidth(selected) <= budget ? (base && rest > 0 ? `${selected} · ${base}` : selected) : base;
	return frame(body, {
		width,
		height,
		title,
		meta,
		border: (s) => theme.fg(p.focused ? "borderAccent" : "border", s),
		titleStyle: (s) => (p.focused ? theme.bold(theme.fg("accent", s)) : theme.fg("muted", s)),
		metaStyle: (s) => theme.fg("dim", s),
	});
}

function renderRow(row: SessionRow, inner: number, isCursor: boolean, isCurrent: boolean, p: SessionsPaneProps): string[] {
	const { theme } = p;
	const indent = "  ".repeat(row.threadDepth ?? 0);
	// 光标标记 ›（占第一列，第二列留空对齐）；多选不再画图标，只靠标题着色区分。
	const isSelected = p.selected.has(row.file);
	const marker = `${isCursor ? "›" : " "} `;
	const date = formatShortDate(row.updatedAt);
	const emptyTitle = t("pane.emptySession");
	const title = row.name ?? row.preview ?? emptyTitle;
	// pi 当前打开的会话：标题后紧跟一个 (current) / （当前）标记，不特殊着色。
	const currentTag = isCurrent ? t("pane.current") : "";
	const tagW = visibleWidth(currentTag);

	// line 1: marker + indent + title[(current)] ....... date
	const rightW = visibleWidth(date) + 1;
	const titleW = Math.max(1, inner - visibleWidth(marker) - visibleWidth(indent) - rightW - tagW);
	// 先不补齐地截断标题，紧跟上标记，再把整体补齐到 titleW + tagW——这样标记紧贴标题，右侧空白补齐后日期照旧右对齐。
	const titleWithTag = truncateToWidth(title || emptyTitle, titleW, "…", false) + currentTag;
	const titleText = truncateToWidth(titleWithTag, titleW + tagW, "…", true);

	// line 2: model · cwd · N msgs
	const details = [row.model ?? "", shortenPath(row.cwd), t("pane.msgs", { count: row.messageCount })].filter(Boolean).join(" · ");
	const line2Raw = `  ${indent}${truncateToWidth(details, Math.max(1, inner - 2 - visibleWidth(indent)), "…", false)}`;

	if (isCursor) {
		const hl = (s: string) => theme.bg("selectedBg", fit(s, inner));
		// 光标行整行反白；被选中时标题额外着 accent 色。
		const titleSpan = isSelected ? theme.bold(theme.fg("accent", titleText)) : theme.bold(titleText);
		return [
			hl(theme.bold(theme.fg("accent", marker[0]!)) + marker.slice(1) + indent + titleSpan + " " + theme.fg("dim", date)),
			hl(theme.fg("muted", line2Raw)),
		];
	}
	// 选中行：标题用 accent 色，一眼能从列表里扫出来；未选中用普通 text 色。
	const titleStyle = isSelected ? (s: string) => theme.fg("accent", s) : (s: string) => theme.fg("text", s);
	return [
		fit(marker + indent + titleStyle(titleText) + " " + theme.fg("dim", date), inner),
		fit(theme.fg("muted", line2Raw), inner),
	];
}

/** Header labels of the list scope (localised), long form and the short form used when space is tight. */
export function scopeLabels(scope: ListScope): { long: string; short: string } {
	return scope === "all"
		? { long: t("scope.allLong"), short: t("scope.allShort") }
		: { long: t("scope.currentLong"), short: t("scope.currentShort") };
}

/**
 * Header meta for the sessions pane: "1/15 · Current · recent".
 *
 * 宽度不够时按顺序降级（去掉排序 → 缩短 scope → 只留位置），保证任何宽度下
 * 用户都能看到当前 scope 和会话数量，而不是整段消失。
 */
export function sessionsMeta(total: number, cursor: number, scope: ListScope, sort: SessionSortMode, budget: number): string {
	const label = scopeLabels(scope);
	const sortName = t(`sort.${sort}`);
	const pos = `${Math.min(cursor + 1, total)}/${total}`;
	const candidates = total
		? [`${pos} · ${label.long} · ${sortName}`, `${pos} · ${label.long}`, `${pos} · ${label.short}`, pos]
		: [label.long, label.short];
	return candidates.find((c) => visibleWidth(c) <= budget) ?? candidates[candidates.length - 1]!;
}

/** "3 selected" while sessions are multi-selected with space, "" otherwise. */
export function selectedMeta(count: number): string {
	return count > 0 ? t("pane.selected", { count }) : "";
}

/** First visible index so that `cursor` stays inside a window of `visible` rows. */
export function scrollOffset(cursor: number, total: number, visible: number): number {
	if (total <= visible) return 0;
	const half = Math.floor(visible / 2);
	return Math.min(Math.max(0, cursor - half), total - visible);
}

/** Clamp a first-visible index to a valid window start (0 .. last possible window). */
export function clampFirst(first: number, total: number, visible: number): number {
	return Math.max(0, Math.min(first, Math.max(0, total - visible)));
}
