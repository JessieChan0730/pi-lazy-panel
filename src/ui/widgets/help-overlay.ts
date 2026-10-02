/**
 * Help overlay (`?`). Pure rendering of the focused pane's commands followed
 * by the global ones; selection and scroll state stay in PanelState.
 *
 * 帮助内容来自最终合并后的 keymap。每个动作单独一项，同一动作的多个键位仍合并显示；
 * 描述按可见宽度折行，续行和首行属于同一个选择项。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { actionDescription, isDisabledIn, scopeTitle } from "../../config/keymap.ts";
import { labelsFor, scopeChain } from "../../config/keys.ts";
import { t } from "../../i18n/index.ts";
import type { ActionId, Keymap, KeyScope } from "../../types.ts";
import { clamp, findLastIndex } from "../../utils/indices.ts";
import { fit, frame, overlayCentered } from "../frame.ts";

export interface HelpOverlayProps {
	keymap: Keymap;
	/** Scope the keys currently go to: the focused pane, or the tree dialog while it is open. */
	focus: KeyScope;
	/** Ordinal among binding entries, independent of wrapping and section headers. */
	cursor: number;
	/** First visible row of the help body (for long lists). */
	scroll: number;
	theme: Theme;
}

/** One logical help entry, either a section header or an executable binding. */
export type HelpLine = { kind: "header"; text: string } | { kind: "binding"; action: ActionId; keys: string; text: string } | { kind: "blank" };

/** Build the help body for `focus`: its own bindings first, then each outer scope. */
export function buildHelpLines(keymap: Keymap, focus: KeyScope): HelpLine[] {
	const out: HelpLine[] = [];
	scopeChain(focus).forEach((scope, i) => {
		// 分区标题上方留一行空白，下方紧接命令；装饰行不参与选择。
		out.push({ kind: "blank" });
		out.push({ kind: "header", text: i === 0 ? t("help.currentPane") : scopeTitle(scope) });
		out.push(...buildScopeLines(keymap, scope, focus));
	});
	return out;
}

/** Each action gets its own entry so Enter has one unambiguous target. */
function buildScopeLines(keymap: Keymap, scope: KeyScope, focus: KeyScope): HelpLine[] {
	const out: HelpLine[] = [];
	for (const action of Object.keys(keymap[scope]) as ActionId[]) {
		const labels = labelsFor(keymap, scope, action);
		if (!labels.length || (scope !== focus && isDisabledIn(focus, action))) continue;
		out.push({ kind: "binding", action, keys: compactKeys(labels), text: actionDescription(action) });
	}
	return out;
}

/** Render aliases compactly: ["j", "↓"] → "j/↓", ["1", "2", "3"] → "1..3". */
export function compactKeys(labels: string[]): string {
	if (labels.length >= 3 && labels.every((l) => [...l].length === 1)) {
		const codes = labels.map((l) => l.codePointAt(0)!);
		const consecutive = codes.every((c, i) => i === 0 || c === codes[i - 1]! + 1);
		if (consecutive) return `${labels[0]}..${labels[labels.length - 1]}`;
	}
	return labels.join("/");
}

/** Wrapped rows retain their binding ordinal; headers and blanks have none. */
type HelpRenderRow = { kind: "header"; text: string } | { kind: "blank" } | { kind: "binding"; index: number; keys: string; text: string };

/** Word-wrap by visible columns, hard-breaking words that cannot fit on their own. */
function wrapText(text: string, width: number): string[] {
	if (width <= 0) return [text];
	const out: string[] = [];
	let cur = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const candidate = cur ? `${cur} ${word}` : word;
		if (visibleWidth(candidate) <= width) {
			cur = candidate;
			continue;
		}
		if (cur) out.push(cur);
		let rest = word;
		while (visibleWidth(rest) > width) {
			let take = "";
			for (const ch of [...rest]) {
				if (visibleWidth(take + ch) > width) break;
				take += ch;
			}
			// 极窄描述列连一个宽字符都放不下时也必须前进，最终由 frame 裁切。
			if (!take) take = [...rest][0]!;
			out.push(take);
			rest = rest.slice(take.length);
		}
		cur = rest;
	}
	if (cur) out.push(cur);
	return out.length ? out : [""];
}

/** Shared layout for sizing, cursor-follow scrolling and rendering. */
function helpLayout(keymap: Keymap, focus: KeyScope, inner: number): { rows: HelpRenderRow[]; keyColW: number; count: number } {
	const lines = buildHelpLines(keymap, focus);
	const keyColW = Math.min(16, Math.max(8, ...lines.map((l) => (l.kind === "binding" ? visibleWidth(l.keys) : 0))) + 1);
	// 前导空格 + 两列光标标记 + keys 列 + 描述前的一格空白。
	const descW = Math.max(1, inner - keyColW - 4);
	const rows: HelpRenderRow[] = [];
	let count = 0;
	for (const line of lines) {
		if (line.kind === "blank") {
			rows.push({ kind: "blank" });
		} else if (line.kind === "header") {
			rows.push({ kind: "header", text: line.text });
		} else {
			const index = count++;
			wrapText(line.text, descW).forEach((seg, i) => rows.push({ kind: "binding", index, keys: i === 0 ? line.keys : "", text: seg }));
		}
	}
	return { rows, keyColW, count };
}

/** Width of the help box for a `termW`-column terminal. */
export function helpBoxWidth(termW: number): number {
	return Math.max(30, Math.min(termW - 4, 64));
}

/** Fixed box height, reduced only when the terminal is too short. */
export function helpBoxSize(termW: number, termH: number): { width: number; height: number } {
	const width = helpBoxWidth(termW);
	// 固定高度，不随面板命令数量变化；小终端为上下隔离带留出空间。
	const height = Math.min(28, Math.max(3, termH - 2), Math.max(1, termH));
	return { width, height };
}

/** Keep the selected entry visible after a move or resize; never select a continuation row. */
export function helpViewport(keymap: Keymap, focus: KeyScope, termW: number, termH: number, cursor: number, scroll: number): { cursor: number; scroll: number } {
	const { width, height } = helpBoxSize(termW, termH);
	const { rows, count } = helpLayout(keymap, focus, width - 2);
	cursor = clamp(cursor, 0, Math.max(0, count - 1));
	const visible = Math.max(1, height - 2);
	const maxScroll = Math.max(0, rows.length - visible);
	scroll = clamp(scroll, 0, maxScroll);
	const first = rows.findIndex((row) => row.kind === "binding" && row.index === cursor);
	const last = findLastIndex(rows, (row) => row.kind === "binding" && row.index === cursor);
	if (first < 0) return { cursor: 0, scroll: 0 };
	// 一项放得下就显示完整描述；超出一屏时优先显示首行，确保键位和光标可见。
	// 回到首项时，空间足够就连同上方分区标题一起显示。
	if (cursor === 0 && last < visible) scroll = 0;
	else if (first < scroll || last - first + 1 > visible) scroll = first;
	else if (last >= scroll + visible) scroll = last - visible + 1;
	return { cursor, scroll: clamp(scroll, 0, maxScroll) };
}

/** Render the help box itself (lines of exactly `width`). */
export function renderHelpBox(p: HelpOverlayProps, width: number, height: number): string[] {
	const { theme } = p;
	const inner = width - 2;
	const { rows, keyColW } = helpLayout(p.keymap, p.focus, inner);
	const visible = Math.max(1, height - 2);
	const maxScroll = Math.max(0, rows.length - visible);
	const start = clamp(p.scroll, 0, maxScroll);

	const body: string[] = [];
	for (const row of rows.slice(start, start + visible)) {
		if (row.kind === "blank") {
			body.push("");
		} else if (row.kind === "header") {
			body.push(" " + theme.bold(theme.fg("accent", `-- ${row.text} --`)));
		} else {
			const selected = row.index === p.cursor;
			const marker = selected && row.keys ? "› " : "  ";
			const keys = fit(row.keys ? theme.fg("warning", row.keys) : "", keyColW);
			const line = ` ${theme.fg("accent", marker)}${keys} ${theme.fg(selected ? "accent" : "text", row.text)}`;
			body.push(selected ? theme.bg("selectedBg", fit(line, inner)) : line);
		}
	}

	const more = maxScroll > 0 ? `${start + 1}-${Math.min(rows.length, start + visible)}/${rows.length}` : "";
	const box = frame(body, {
		width,
		height,
		title: `${t("help.titlePrefix")} · ${scopeTitle(p.focus)}`,
		meta: more,
		border: (s) => theme.fg("borderAccent", s),
		titleStyle: (s) => theme.bold(theme.fg("accent", s)),
		metaStyle: (s) => theme.fg("dim", s),
	});
	// 提示嵌在底边，不占命令行数，避免滚动时视口高度跳动。
	const hints = [start > 0 ? t("help.moreAbove") : "", start < maxScroll ? t("help.moreBelow") : ""].filter(Boolean);
	if (hints.length && width >= 4 && height >= 2) {
		const hint = ` ${fit(hints.join("  "), Math.min(visibleWidth(hints.join("  ")), inner - 2))} `;
		const remaining = Math.max(0, inner - visibleWidth(hint));
		const left = Math.floor(remaining / 2);
		box[box.length - 1] = theme.fg("borderAccent", `└${"─".repeat(left)}`) +
			theme.fg("accent", hint) +
			theme.fg("borderAccent", `${"─".repeat(remaining - left)}┘`);
	}
	return box;
}

/** Composite the help box centered over already-rendered panel `lines`. */
export function overlayHelp(lines: string[], p: HelpOverlayProps, termW: number): string[] {
	const { width, height } = helpBoxSize(termW, lines.length);
	return overlayCentered(lines, renderHelpBox(p, width, height), width, termW, (s) => p.theme.fg("dim", s));
}

/** Number of rendered help rows (wrapping included). */
export function helpLineCount(keymap: Keymap, focus: KeyScope, termW: number): number {
	return helpLayout(keymap, focus, helpBoxWidth(termW) - 2).rows.length;
}
