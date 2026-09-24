/**
 * Help overlay (`?`).
 *
 * A centered box drawn over the panel listing the bindings of the focused pane
 * followed by the global ones. Pure rendering: given the resolved keymap and
 * the focused pane, produce lines; the panel composites them over its own
 * output with `overlayCentered` from ../frame.ts.
 *
 *   ┌─ HELP · Sessions pane ─────────────────────┐
 *   │ j/↓          Move cursor down              │
 *   │ gg/G         Go to top / bottom            │
 *   │ ...                                        │
 *   │ Global                                     │
 *   │ h/l/Tab      Focus previous / next pane    │
 *   │ 1..3         Focus pane by number          │
 *   └─ ? / Esc close ─ j/k scroll ───────────────┘
 *
 * 帮助内容直接来自最终合并后的 keymap，所以用户自定义的键位会如实显示。
 * 描述过长时按描述列宽度折行（续行的 keys 列留空），不再用 … 截断——键位说明是重要信息。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { actionDescription, HELP_GROUPS, helpGroupText, isDisabledIn, scopeTitle } from "../../config/keymap.ts";
import { labelsFor, scopeChain } from "../../config/keys.ts";
import { t } from "../../i18n/index.ts";
import type { ActionId, Keymap, KeyScope } from "../../types.ts";
import { fit, frame, overlayCentered } from "../frame.ts";

export interface HelpOverlayProps {
	keymap: Keymap;
	/** Scope the keys currently go to: the focused pane, or the tree dialog while it is open. */
	focus: KeyScope;
	/** First visible row of the help body (for long lists). */
	scroll: number;
	theme: Theme;
}

/** One line of the help body, either a section header or a binding. */
export type HelpLine = { kind: "header"; text: string } | { kind: "binding"; keys: string; text: string } | { kind: "blank" };

/** Build the help body for `focus`: its own bindings first, then each outer scope (pane → global; dialog → tree pane → global). */
export function buildHelpLines(keymap: Keymap, focus: KeyScope): HelpLine[] {
	const out: HelpLine[] = [];
	for (const scope of scopeChain(focus)) {
		if (out.length) out.push({ kind: "blank" });
		out.push({ kind: "header", text: scopeTitle(scope) });
		out.push(...buildScopeLines(keymap, scope, focus));
	}
	return out;
}

/**
 * Binding lines of one scope. Actions that belong to a HELP_GROUPS entry are
 * merged into one line (placed where the first bound member appears) as long as
 * at least two members are bound in this scope. Outer-scope actions switched
 * off in `focus` (see DISABLED_ACTIONS) are left out.
 *
 * 同组动作合并成一行；组内只剩一个绑定时退回单独一行，避免描述和键位对不上。
 */
function buildScopeLines(keymap: Keymap, scope: KeyScope, focus: KeyScope): HelpLine[] {
	const out: HelpLine[] = [];
	const consumed = new Set<ActionId>();
	const bound = (a: ActionId) => labelsFor(keymap, scope, a).length > 0 && !(scope !== focus && isDisabledIn(focus, a));
	const actions = (Object.keys(keymap[scope]) as ActionId[]).filter(bound);
	for (const action of actions) {
		if (consumed.has(action)) continue;
		const labels = labelsFor(keymap, scope, action);

		const group = HELP_GROUPS.find((g) => g.actions.includes(action));
		const members = group ? group.actions.filter(bound) : [];
		if (group && members.length >= 2) {
			for (const m of members) consumed.add(m);
			const keys = members.flatMap((m) => labelsFor(keymap, scope, m));
			out.push({ kind: "binding", keys: compactKeys(keys), text: helpGroupText(group) });
			continue;
		}
		out.push({ kind: "binding", keys: compactKeys(labels), text: actionDescription(action) });
	}
	return out;
}

/**
 * Render a list of key labels compactly.
 *   ["1","2","3"]      -> "1..3"      (3+ consecutive single characters)
 *   ["d","t","u","L"]  -> "d/t/u/L"
 *   ["j","↓"]          -> "j/↓"
 */
export function compactKeys(labels: string[]): string {
	if (labels.length >= 3 && labels.every((l) => [...l].length === 1)) {
		const codes = labels.map((l) => l.codePointAt(0)!);
		const consecutive = codes.every((c, i) => i === 0 || c === codes[i - 1]! + 1);
		if (consecutive) return `${labels[0]}..${labels[labels.length - 1]}`;
	}
	return labels.join("/");
}

/** A concrete rendered row of the help body, after wrapping long descriptions. */
type HelpRenderRow = { kind: "header"; text: string } | { kind: "blank" } | { kind: "binding"; keys: string; text: string };

/**
 * Word-wrap `text` into lines of at most `width` visible columns. Words that do
 * not fit on a line of their own are hard-broken by columns.
 *
 * 帮助描述按可见宽度折行：英文按空格断词，单词超宽再按列硬断；中文描述通常够短、不折行。
 */
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
		if (cur) {
			out.push(cur);
			cur = "";
		}
		// 单词自身就超过一行：按可见列硬断成多段。
		let rest = word;
		while (visibleWidth(rest) > width) {
			let take = "";
			for (const ch of [...rest]) {
				if (visibleWidth(take + ch) > width) break;
				take += ch;
			}
			out.push(take);
			rest = rest.slice(take.length);
		}
		cur = rest;
	}
	if (cur) out.push(cur);
	return out.length ? out : [""];
}

/**
 * Expand the logical help lines into concrete rendered rows for a box whose
 * inner width is `inner`: a binding's description is wrapped onto continuation
 * rows (with a blank key column) instead of being truncated. `keyColW` is the
 * shared width of the key column.
 *
 * keyColW / inner 都是终端宽度的确定函数，所以行数在 helpBoxSize、renderHelpBox、
 * helpLineCount 三处算出来一致，滚动和高度不会对不上。
 */
function helpLayout(keymap: Keymap, focus: KeyScope, inner: number): { rows: HelpRenderRow[]; keyColW: number } {
	const lines = buildHelpLines(keymap, focus);
	const keyColW = Math.min(16, Math.max(8, ...lines.map((l) => (l.kind === "binding" ? visibleWidth(l.keys) : 0))) + 1);
	// 描述列可用宽度 = 内宽 - 前导空格 - keys 列 - keys 后的一个空格。
	const descW = Math.max(1, inner - keyColW - 2);
	const rows: HelpRenderRow[] = [];
	for (const line of lines) {
		if (line.kind === "blank") {
			rows.push({ kind: "blank" });
		} else if (line.kind === "header") {
			rows.push({ kind: "header", text: line.text });
		} else {
			// 首行带 keys，续行 keys 列留空、描述接着往下排。
			wrapText(line.text, descW).forEach((seg, i) => rows.push({ kind: "binding", keys: i === 0 ? line.keys : "", text: seg }));
		}
	}
	return { rows, keyColW };
}

/** Width of the help box for a `termW`-column terminal. */
export function helpBoxWidth(termW: number): number {
	return Math.max(30, Math.min(termW - 4, 64));
}

/** Size of the box for a given terminal size (height grows with the wrapped row count). */
export function helpBoxSize(termW: number, termH: number, keymap: Keymap, focus: KeyScope): { width: number; height: number } {
	const width = helpBoxWidth(termW);
	const rowCount = helpLayout(keymap, focus, width - 2).rows.length;
	// +2 for borders
	const height = Math.max(6, Math.min(termH - 2, rowCount + 2));
	return { width, height };
}

/** Render the help box itself (lines of exactly `width`). */
export function renderHelpBox(p: HelpOverlayProps, width: number, height: number): string[] {
	const { theme } = p;
	const inner = width - 2;
	const { rows, keyColW } = helpLayout(p.keymap, p.focus, inner);
	const visible = Math.max(1, height - 2);
	const maxScroll = Math.max(0, rows.length - visible);
	const start = Math.min(Math.max(0, p.scroll), maxScroll);

	const body: string[] = [];
	for (const row of rows.slice(start, start + visible)) {
		if (row.kind === "blank") {
			body.push("");
		} else if (row.kind === "header") {
			body.push(" " + theme.bold(theme.fg("accent", row.text)));
		} else {
			// 续行的 keys 为空，只占位对齐；描述由 helpLayout 折过行，这里不再截断。
			const keys = fit(row.keys ? theme.fg("warning", row.keys) : "", keyColW);
			body.push(` ${keys} ${theme.fg("text", row.text)}`);
		}
	}

	const more = maxScroll > 0 ? ` ${start + 1}-${Math.min(rows.length, start + visible)}/${rows.length}` : "";
	return frame(body, {
		width,
		height,
		title: `${t("help.titlePrefix")} · ${scopeTitle(p.focus)}`,
		meta: `${t("help.closeHint")}${maxScroll > 0 ? ` · ${t("help.scrollHint")}` : ""}${more}`,
		border: (s) => theme.fg("borderAccent", s),
		titleStyle: (s) => theme.bold(theme.fg("accent", s)),
		metaStyle: (s) => theme.fg("dim", s),
	});
}

/** Composite the help box centered over already-rendered panel `lines`. */
export function overlayHelp(lines: string[], p: HelpOverlayProps, termW: number): string[] {
	const { width, height } = helpBoxSize(termW, lines.length, p.keymap, p.focus);
	return overlayCentered(lines, renderHelpBox(p, width, height), width, termW);
}

/** Number of rendered help rows (wrapping included), used by the panel to clamp help scrolling. */
export function helpLineCount(keymap: Keymap, focus: KeyScope, termW: number): number {
	return helpLayout(keymap, focus, helpBoxWidth(termW) - 2).rows.length;
}
