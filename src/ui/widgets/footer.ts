/**
 * Footer bar.
 *
 * Single line at the bottom of the panel:
 *   │ NORMAL │ / Search   ? Help   Tab Focus   Enter Restore   y Copy   gg G │
 *
 * Shows the current mode and the most relevant bindings for the focused pane.
 * When search mode is active it is replaced by the search bar (later task).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { PaneId, PanelMode } from "../../types.ts";
import { fit } from "../frame.ts";

export interface FooterProps {
	mode: PanelMode;
	focus: PaneId;
	theme: Theme;
	/** Optional status text (e.g. "loading…" or an error). */
	status?: string;
}

const HINTS: Record<PaneId, Array<[string, string]>> = {
	sessions: [
		["/", "Search"],
		["?", "Help"],
		["Tab", "Focus"],
		["Enter", "Resume"],
		["d", "Delete"],
		["r", "Rename"],
		["q", "Quit"],
	],
	tree: [
		["/", "Search"],
		["?", "Help"],
		["Tab", "Focus"],
		["Enter", "Restore"],
		["l", "Label"],
		["y", "Copy"],
		["q", "Quit"],
	],
	content: [
		["/", "Search"],
		["?", "Help"],
		["Tab", "Focus"],
		["y", "Copy"],
		["v", "Preview"],
		["gg G", "Top/Bottom"],
		["q", "Quit"],
	],
};

export function renderFooter(p: FooterProps, width: number): string[] {
	const { theme } = p;
	const mode = theme.bold(theme.bg("selectedBg", ` ${p.mode.toUpperCase()} `));
	const hints = HINTS[p.focus].map(([k, d]) => `${theme.bold(theme.fg("accent", k))} ${theme.fg("muted", d)}`).join("   ");
	const status = p.status ? `   ${theme.fg("warning", p.status)}` : "";
	return [fit(`${mode} ${hints}${status}`, width)];
}
