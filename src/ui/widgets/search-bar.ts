/**
 * Search bar (lazygit-style).
 *
 * Replaces the footer row while the user is typing a query:
 *
 *   搜索: foo▏                              Enter search · Esc cancel
 *
 * After Enter the bar shows the query and match position ("1/12") and the
 * panel returns to normal mode; n / N step through matches.
 *
 * The editing state is a `PromptBar` (see ./prompt-bar.ts) configured with the
 * search label; this module adds the "after submit" status line.
 *
 * 匹配/高亮在后续任务里实现，这里只有输入和状态行。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
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
	/** 1-based index of the current match, 0 when none. */
	current: number;
	total: number;
	theme: Theme;
}

/**
 * Render the "after submit" state shown in the footer:
 *   搜索: foo   1/12   n next · N prev · Esc clear
 */
export function renderSearchStatus(p: SearchStatusProps, width: number): string {
	const { theme } = p;
	const label = theme.bold(theme.fg("accent", SEARCH_LABEL));
	const count = p.total > 0 ? theme.fg("success", `${p.current}/${p.total}`) : theme.fg("warning", "no matches");
	const hint = `${theme.fg("dim", "n")} ${theme.fg("muted", "next")}  ${theme.fg("dim", "N")} ${theme.fg("muted", "prev")}  ${theme.fg("dim", "Esc")} ${theme.fg("muted", "clear")}`;
	return fit(`${label}${theme.fg("text", p.query)}   ${count}   ${hint}`, width);
}
