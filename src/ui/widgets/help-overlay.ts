/**
 * Help overlay (`?`).
 *
 * A centered box drawn over the panel listing the bindings of the focused pane
 * followed by the global ones. Pure rendering: given the resolved keymap and
 * the focused pane, produce lines; the panel composites them over its own
 * output with pi-tui's `compositeTuiLine`.
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
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { compositeTuiLine, visibleWidth } from "@earendil-works/pi-tui";
import { ACTION_DESCRIPTIONS, HELP_GROUPS, SCOPE_TITLES } from "../../config/keymap.ts";
import { labelsFor } from "../../config/keys.ts";
import type { ActionId, Keymap, KeyScope, PaneId } from "../../types.ts";
import { fit, frame } from "../frame.ts";

export interface HelpOverlayProps {
	keymap: Keymap;
	focus: PaneId;
	/** First visible row of the help body (for long lists). */
	scroll: number;
	theme: Theme;
}

/** One line of the help body, either a section header or a binding. */
export type HelpLine = { kind: "header"; text: string } | { kind: "binding"; keys: string; text: string } | { kind: "blank" };

/** Build the help body for `focus`: pane bindings first, then global. */
export function buildHelpLines(keymap: Keymap, focus: PaneId): HelpLine[] {
	const out: HelpLine[] = [];
	const scopes: KeyScope[] = [focus, "global"];
	for (const scope of scopes) {
		if (out.length) out.push({ kind: "blank" });
		out.push({ kind: "header", text: SCOPE_TITLES[scope] });
		out.push(...buildScopeLines(keymap, scope));
	}
	return out;
}

/**
 * Binding lines of one scope. Actions that belong to a HELP_GROUPS entry are
 * merged into one line (placed where the first bound member appears) as long as
 * at least two members are bound in this scope.
 *
 * 同组动作合并成一行；组内只剩一个绑定时退回单独一行，避免描述和键位对不上。
 */
function buildScopeLines(keymap: Keymap, scope: KeyScope): HelpLine[] {
	const out: HelpLine[] = [];
	const consumed = new Set<ActionId>();
	const actions = Object.keys(keymap[scope]) as ActionId[];
	for (const action of actions) {
		if (consumed.has(action)) continue;
		const labels = labelsFor(keymap, scope, action);
		if (labels.length === 0) continue;

		const group = HELP_GROUPS.find((g) => g.actions.includes(action));
		const members = group ? group.actions.filter((a) => labelsFor(keymap, scope, a).length > 0) : [];
		if (group && members.length >= 2) {
			for (const m of members) consumed.add(m);
			const keys = members.flatMap((m) => labelsFor(keymap, scope, m));
			out.push({ kind: "binding", keys: compactKeys(keys), text: group.text });
			continue;
		}
		out.push({ kind: "binding", keys: compactKeys(labels), text: ACTION_DESCRIPTIONS[action] });
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

/** Size of the box for a given terminal size. */
export function helpBoxSize(termW: number, termH: number, lineCount: number): { width: number; height: number } {
	const width = Math.max(30, Math.min(termW - 4, 64));
	// +2 for borders
	const height = Math.max(6, Math.min(termH - 2, lineCount + 2));
	return { width, height };
}

/** Render the help box itself (lines of exactly `width`). */
export function renderHelpBox(p: HelpOverlayProps, width: number, height: number): string[] {
	const { theme } = p;
	const inner = width - 2;
	const lines = buildHelpLines(p.keymap, p.focus);
	const visible = Math.max(1, height - 2);
	const maxScroll = Math.max(0, lines.length - visible);
	const start = Math.min(Math.max(0, p.scroll), maxScroll);
	const keyColW = Math.min(16, Math.max(8, ...lines.map((l) => (l.kind === "binding" ? visibleWidth(l.keys) : 0))) + 1);

	const body: string[] = [];
	for (const line of lines.slice(start, start + visible)) {
		if (line.kind === "blank") {
			body.push("");
		} else if (line.kind === "header") {
			body.push(" " + theme.bold(theme.fg("accent", line.text)));
		} else {
			const keys = fit(theme.fg("warning", line.keys), keyColW);
			body.push(` ${keys} ${theme.fg("text", line.text)}`);
		}
	}

	const more = maxScroll > 0 ? ` ${start + 1}-${Math.min(lines.length, start + visible)}/${lines.length}` : "";
	return frame(body, {
		width,
		height,
		title: `HELP · ${SCOPE_TITLES[p.focus]}`,
		meta: `? / Esc close${maxScroll > 0 ? " · j/k scroll" : ""}${more}`,
		border: (s) => theme.fg("borderAccent", s),
		titleStyle: (s) => theme.bold(theme.fg("accent", s)),
		metaStyle: (s) => theme.fg("dim", s),
	});
}

/** Composite the help box centered over already-rendered panel `lines`. */
export function overlayHelp(lines: string[], p: HelpOverlayProps, termW: number): string[] {
	const termH = lines.length;
	const count = buildHelpLines(p.keymap, p.focus).length;
	const { width, height } = helpBoxSize(termW, termH, count);
	const box = renderHelpBox(p, width, height);
	const top = Math.max(0, Math.floor((termH - height) / 2));
	const left = Math.max(0, Math.floor((termW - width) / 2));
	const out = [...lines];
	for (let i = 0; i < box.length && top + i < out.length; i++) {
		out[top + i] = compositeTuiLine(out[top + i] ?? "", box[i]!, left, width, termW);
	}
	return out;
}

/** Number of body lines, used by the panel to clamp help scrolling. */
export function helpLineCount(keymap: Keymap, focus: PaneId): number {
	return buildHelpLines(keymap, focus).length;
}
