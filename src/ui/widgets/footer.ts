/**
 * Footer bar.
 *
 * Single line at the bottom of the panel:
 *   │ NORMAL │ / Search   ? Help   l Focus   Enter Resume   d Delete   q Quit
 *
 * Shows the current mode and the most relevant bindings for the focused pane.
 * Hints are derived from the resolved keymap, so custom bindings show up here.
 * When search mode is active the panel renders the search bar instead; while a
 * dialog owns the keyboard (label / restore mode) the panel passes the
 * dialog's own hints via `hints`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FOOTER_HINTS } from "../../config/keymap.ts";
import { labelsForFocus } from "../../config/keys.ts";
import type { ActionId, KeyHint, Keymap, ListScope, PaneId, PanelMode } from "../../types.ts";
import { fit } from "../frame.ts";

export interface FooterProps {
	mode: PanelMode;
	focus: PaneId;
	keymap: Keymap;
	theme: Theme;
	/** Current list scope; the hint for the scope already active is hidden ("A All" while on Current). */
	scope?: ListScope;
	/** Optional status text (e.g. "loading…" or an error). */
	status?: string;
	/** Replace the keymap-derived hints, e.g. with a dialog's keys while it is open. */
	hints?: KeyHint[];
}

/** Scope actions are one-way, so only the one that would change something is worth a hint. */
const SCOPE_ACTION_OF: Record<ListScope, ActionId> = {
	"current-folder": "scope-current",
	all: "scope-all",
};

/** Short footer wording per action (falls back to the action id). */
const SHORT: Partial<Record<ActionId, string>> = {
	search: "Search",
	help: "Help",
	"focus-next": "Focus",
	"scope-current": "Current",
	"scope-all": "All",
	quit: "Quit",
	"session-resume": "Resume",
	"session-delete": "Delete",
	"session-rename": "Rename",
	"tree-restore": "Restore",
	"tree-open": "Tree",
	"tree-label": "Label",
	"tree-copy": "Copy",
	"go-top": "Top",
	"go-bottom": "Bottom",
};

export function renderFooter(p: FooterProps, width: number): string[] {
	const { theme } = p;
	const mode = theme.bold(theme.bg("selectedBg", ` ${p.mode.toUpperCase()} `));
	const status = p.status ? `  ${theme.fg("warning", p.status)}` : "";
	const budget = width - visibleWidth(mode) - visibleWidth(status) - 1;

	// 只显示放得下的提示，避免窄终端里被截断成半个词。
	const parts: string[] = [];
	let used = 0;
	for (const [key, text] of p.hints ?? keymapHints(p)) {
		const part = `${theme.bold(theme.fg("accent", key))} ${theme.fg("muted", text)}`;
		const w = visibleWidth(part) + (parts.length ? 3 : 0);
		if (used + w > budget) break;
		parts.push(part);
		used += w;
	}
	return [fit(`${mode} ${parts.join("   ")}${status}`, width)];
}

/** Hints of the focused pane from the resolved keymap, in FOOTER_HINTS order. */
function keymapHints(p: FooterProps): KeyHint[] {
	// 当前已经是 Current 就不提示 C Current，只提示 A All；反之亦然。
	const activeScopeAction = p.scope ? SCOPE_ACTION_OF[p.scope] : undefined;
	const out: KeyHint[] = [];
	for (const action of FOOTER_HINTS[p.focus]) {
		if (action === activeScopeAction) continue;
		const labels = labelsForFocus(p.keymap, p.focus, action);
		if (labels.length === 0) continue;
		out.push([labels[0]!, SHORT[action] ?? action]);
	}
	return out;
}
