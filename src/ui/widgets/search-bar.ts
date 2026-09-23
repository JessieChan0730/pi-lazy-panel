/**
 * Search bar (lazygit-style).
 *
 * Replaces the footer row while the user is typing a query:
 *
 *   搜索: foo▏                              Enter search · Esc cancel
 *
 * Typing jumps to the first match live; Enter keeps the query and hands the
 * keys back to the pane, Esc drops it and puts the cursor back where it was
 * (the panel does both, see ../app.ts). Afterwards the footer shows the query,
 * the match position and the keys that step through the matches:
 *
 *   搜索: foo   2/7   n next  N prev  Esc clear   copied node text
 *
 * The editing state is a `PromptBar` (see ./prompt-bar.ts) configured with the
 * search label; this module adds the "after Enter" status line.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeyHint } from "../../types.ts";
import { fit } from "../frame.ts";
import { PromptBar, type PromptBarOptions } from "./prompt-bar.ts";

/** Label shown in front of the input; "搜索:" like lazygit's "Search:". */
export const SEARCH_LABEL = "搜索: ";

export type SearchBarOptions = Omit<PromptBarOptions, "label" | "hints">;

export class SearchBar extends PromptBar {
	constructor(o: SearchBarOptions) {
		super({ ...o, label: SEARCH_LABEL, hints: [["Enter", "search"], ["Esc", "cancel"]] });
	}
}

export interface SearchStatusProps {
	query: string;
	/** 1-based position of the current match, 0 when the cursor is not on one. */
	position: number;
	total: number;
	/** Keys that step through / clear the matches, from the resolved keymap (`n next`, `N prev`, `Esc clear`). */
	hints: KeyHint[];
	/** Footer status text (copy / label results…), shown after the hints. */
	status?: string;
	theme: Theme;
}

/**
 * Render the "after Enter" state shown in the footer:
 *   搜索: foo   2/7   n next  N prev  Esc clear
 * The position reads "7" while the cursor is off the matches and "no matches" for none.
 */
export function renderSearchStatus(p: SearchStatusProps, width: number): string {
	const { theme } = p;
	const label = theme.bold(theme.fg("accent", SEARCH_LABEL));
	const count =
		p.total === 0
			? theme.fg("warning", "no matches")
			: theme.fg("success", p.position > 0 ? `${p.position}/${p.total}` : String(p.total));
	const hint = p.hints.map(([k, t]) => `${theme.fg("dim", k)} ${theme.fg("muted", t)}`).join("  ");
	const status = p.status ? `   ${theme.fg("warning", p.status)}` : "";
	return fit(`${label}${theme.fg("text", p.query)}   ${count}   ${hint}${status}`, width);
}
