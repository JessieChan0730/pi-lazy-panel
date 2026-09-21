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
 * Wraps pi-tui's `Input` so we get cursor movement, word deletion, paste and
 * kill-ring for free. This module only owns rendering + the input widget; the
 * panel decides what to do on submit / cancel and stores the last query.
 *
 * 本任务只做“按下 / 显示搜索栏并可输入”的效果，真正的匹配/高亮在后续任务里实现。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, visibleWidth } from "@earendil-works/pi-tui";
import { fit } from "../frame.ts";

/** Label shown in front of the input; "搜索:" like lazygit's "Search:". */
export const SEARCH_LABEL = "搜索: ";

export interface SearchBarOptions {
	theme: Theme;
	onSubmit: (query: string) => void;
	onCancel: () => void;
	/** Called after every keystroke so the panel can re-render. */
	onChange: () => void;
}

export class SearchBar {
	private readonly input: Input;
	private _focused = false;

	constructor(private readonly o: SearchBarOptions) {
		this.input = new Input();
		this.input.onSubmit = (v) => this.o.onSubmit(v);
		this.input.onEscape = () => this.o.onCancel();
	}

	/** Focusable propagation (IME cursor): mirrored from the root component. */
	get focused(): boolean {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
		this.input.focused = v;
	}

	getValue(): string {
		return this.input.getValue();
	}

	/** Reset the field (optionally pre-filled with the previous query). */
	reset(value = ""): void {
		this.input.setValue(value);
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
		this.o.onChange();
	}

	/** Render the editing state of the bar as one line of exactly `width`. */
	render(width: number): string[] {
		const { theme } = this.o;
		const label = theme.bold(theme.fg("accent", SEARCH_LABEL));
		const hint = `${theme.fg("dim", "Enter")} ${theme.fg("muted", "search")}  ${theme.fg("dim", "Esc")} ${theme.fg("muted", "cancel")}`;
		const hintW = visibleWidth(hint);
		const labelW = visibleWidth(SEARCH_LABEL);
		let inputW = width - labelW - hintW - 2;
		let showHint = true;
		if (inputW < 10) {
			showHint = false;
			inputW = Math.max(1, width - labelW);
		}
		const field = this.input.render(inputW)[0] ?? "";
		const line = showHint ? `${label}${fit(field, inputW)}  ${hint}` : `${label}${field}`;
		return [fit(line, width)];
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
