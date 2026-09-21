/**
 * Footer bar.
 *
 * Single line at the bottom of the panel:
 *   │ NORMAL │ / Search   ? Help   Tab Focus   Enter Resume   d Delete   q Quit
 *
 * Shows the current mode and the most relevant bindings for the focused pane.
 * Hints are derived from the resolved keymap, so custom bindings show up here.
 * When search mode is active the panel renders the search bar instead.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FOOTER_HINTS } from "../../config/keymap.ts";
import { labelsForFocus } from "../../config/keys.ts";
import type { ActionId, Keymap, PaneId, PanelMode } from "../../types.ts";
import { fit } from "../frame.ts";

export interface FooterProps {
	mode: PanelMode;
	focus: PaneId;
	keymap: Keymap;
	theme: Theme;
	/** Optional status text (e.g. "loading…" or an error). */
	status?: string;
}

/** Short footer wording per action (falls back to the action id). */
const SHORT: Partial<Record<ActionId, string>> = {
	search: "Search",
	help: "Help",
	"focus-next": "Focus",
	"toggle-scope": "Scope",
	quit: "Quit",
	"session-resume": "Resume",
	"session-delete": "Delete",
	"session-rename": "Rename",
	"tree-restore": "Restore",
	"tree-label": "Label",
	"tree-copy": "Copy",
	yank: "Copy",
	"preview-toggle": "Preview",
	"go-top": "Top",
};

export function renderFooter(p: FooterProps, width: number): string[] {
	const { theme } = p;
	const mode = theme.bold(theme.bg("selectedBg", ` ${p.mode.toUpperCase()} `));
	const status = p.status ? `  ${theme.fg("warning", p.status)}` : "";
	const budget = width - visibleWidth(mode) - visibleWidth(status) - 1;

	// 只显示放得下的提示，避免窄终端里被截断成半个词。
	const parts: string[] = [];
	let used = 0;
	for (const action of FOOTER_HINTS[p.focus]) {
		const labels = labelsForFocus(p.keymap, p.focus, action);
		if (labels.length === 0) continue;
		const key = labels[0]!;
		const part = `${theme.bold(theme.fg("accent", key))} ${theme.fg("muted", SHORT[action] ?? action)}`;
		const w = visibleWidth(part) + (parts.length ? 3 : 0);
		if (used + w > budget) break;
		parts.push(part);
		used += w;
	}
	return [fit(`${mode} ${parts.join("   ")}${status}`, width)];
}
