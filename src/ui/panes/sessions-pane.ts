/**
 * Sessions pane (left, top).
 *
 * Lists `SessionRow[]`. Each row uses two lines:
 *
 *   › FilmRecall                        09-20 22:18
 *     opus-4 · ~/code/myself/FilmRecall · 128 msgs
 *
 * Pinned sessions (sorted to the front by sortSessions) are grouped under a
 * dim `── PINNED ──` rule and the rest under `── OTHERS ──`; the rules only
 * appear when something is pinned. A rule is a single line hugging the rows on
 * both sides. The pane lays its content out as a flat line buffer and scrolls
 * by line, so a rule need not be the same height as a row (the mouse hit-test
 * maps a clicked line back to its session, see ../mouse.ts).
 *
 * The cursor row is highlighted; sessions picked with space have no marker
 * glyph — their title is tinted accent so selected rows stand out in a long
 * list — and the header starts with "3 selected". While a `/` search is active
 * in the pane the matching rows get their hits painted (see
 * ../search-highlight.ts) and the header counts them ("2/7 matches"); the list
 * itself is never filtered.
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
	/** First visible slot; defaults to a cursor-centered window when omitted (keyboard). Slot space, see the group rules. */
	first?: number;
	focused: boolean;
	scope: ListScope;
	sort: SessionSortMode;
	selected: Set<string>;
	/** How many of the leading rows are pinned (they are contiguous at the top); drives the PINNED / OTHERS group rules. */
	pinnedCount?: number;
	/** File pi currently has open, if any: that row's title gets a "current" tag (it is the one `d` refuses). */
	currentFile?: string;
	/** Active `/` search of this pane: matching rows are highlighted, the header shows the count. */
	search?: SearchView;
	/** Frame title; the panel passes "[1] SESSIONS" so the jump key is visible. */
	title?: string;
	theme: Theme;
}

/**
 * A rendered element: a session row (2 lines) or a group rule (PINNED /
 * OTHERS). The pane lays elements out as a flat line buffer and scrolls by
 * line (like the content pane), so the rule can carry a symmetric one-line gap
 * above and below without forcing every row to the same height.
 */
type SessionElement = { kind: "session"; index: number } | { kind: "header"; label: string };

/** Lines a session row occupies. */
const ROW_LINES = 2;
/** Lines a group rule occupies: just the rule, hugging the rows on both sides (no blank padding). */
const HEADER_LINES = 1;

/**
 * Elements the pane renders, top to bottom. With `pinnedCount` P > 0 the pinned
 * rows (indices 0..P-1, already sorted to the front) sit under a PINNED rule
 * and the rest under an OTHERS rule; with P === 0 the elements are the rows 1:1
 * (no rules, identical to before pinning existed).
 */
function sessionElements(total: number, pinnedCount: number): SessionElement[] {
	const p = clampPinned(pinnedCount, total);
	if (p === 0) return Array.from({ length: total }, (_, index) => ({ kind: "session", index }) as SessionElement);
	const els: SessionElement[] = [{ kind: "header", label: t("pane.pinnedGroup") }];
	for (let i = 0; i < total; i++) {
		if (i === p) els.push({ kind: "header", label: t("pane.othersGroup") });
		els.push({ kind: "session", index: i });
	}
	return els;
}

function elementLines(el: SessionElement): number {
	return el.kind === "header" ? HEADER_LINES : ROW_LINES;
}

/** Total body lines the pane renders (rows + the group rules, when pinned). */
export function sessionLineCount(total: number, pinnedCount: number): number {
	return sessionElements(total, pinnedCount).reduce((n, el) => n + elementLines(el), 0);
}

/** Body line a session's first row line lands on (used to keep the cursor's row in the window). */
export function sessionFirstLine(index: number, total: number, pinnedCount: number): number {
	let line = 0;
	for (const el of sessionElements(total, pinnedCount)) {
		if (el.kind === "session" && el.index === index) return line;
		line += elementLines(el);
	}
	return line;
}

/** Session a body line maps to, or undefined for a group rule / blank / out-of-range line (a click there moves nothing). */
export function sessionAtLine(lineIndex: number, total: number, pinnedCount: number): number | undefined {
	let line = 0;
	for (const el of sessionElements(total, pinnedCount)) {
		const h = elementLines(el);
		if (lineIndex >= line && lineIndex < line + h) return el.kind === "session" ? el.index : undefined;
		line += h;
	}
	return undefined;
}

function clampPinned(pinnedCount: number, total: number): number {
	return Math.max(0, Math.min(pinnedCount, total));
}

export function renderSessionsPane(p: SessionsPaneProps, width: number, height: number): string[] {
	const { theme } = p;
	const inner = width - 2;
	const visibleLines = Math.max(1, height - 2);
	const body: string[] = [];

	if (p.rows.length === 0) {
		body.push(theme.fg("muted", ` ${t("pane.sessionsEmpty")}`));
	} else {
		// pi 当前打开的会话（比较解析后的路径，和 findSessionIndex 一致）：这一行会带 current 标记。
		const currentResolved = p.currentFile ? resolve(p.currentFile) : undefined;
		const pinnedCount = p.pinnedCount ?? 0;
		// 先把整份内容排成行缓冲（会话 2 行、分隔线 3 行：空 / 横线 / 空），再按行窗口切片。
		const lines: string[] = [];
		for (const el of sessionElements(p.rows.length, pinnedCount)) {
			if (el.kind === "header") {
				lines.push(renderGroupHeader(el.label, inner, theme));
				continue;
			}
			const i = el.index;
			const row = p.rows[i]!;
			const isCursor = i === p.cursor;
			const isCurrent = currentResolved !== undefined && resolve(row.file) === currentResolved;
			const rowLines = renderRow(row, inner, isCursor, isCurrent, p);
			// 搜索命中的行：两行里出现的关键词都加高亮，光标所在的当前匹配再加强调。
			const search = p.search;
			if (search?.matches.has(i)) {
				const style = matchStyle(theme, i === search.current);
				lines.push(...rowLines.map((l) => highlightLine(l, search.terms, style)));
			} else {
				lines.push(...rowLines);
			}
		}
		// 滚轮滚动时用给定的 first（行偏移，不动光标）；否则按光标所在行居中。
		const cursorLine = sessionFirstLine(p.cursor, p.rows.length, pinnedCount);
		const first = clampFirst(p.first ?? scrollOffset(cursorLine, lines.length, visibleLines), lines.length, visibleLines);
		for (let ln = first; ln < Math.min(lines.length, first + visibleLines); ln++) body.push(lines[ln]!);
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

/** A dim group rule: `── PINNED ─────────` filling the pane width. */
function renderGroupHeader(label: string, inner: number, theme: Theme): string {
	const text = `── ${label} `;
	const rule = "─".repeat(Math.max(0, inner - visibleWidth(text)));
	return theme.fg("dim", fit(text + rule, inner));
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
		// 截断会在省略号前后插入完整重置码，分段补回背景，避免高亮在行中断开。
		const hl = (s: string) => fit(s, inner).split("\x1b[0m").map((part) => theme.bg("selectedBg", part)).join("\x1b[0m");
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
