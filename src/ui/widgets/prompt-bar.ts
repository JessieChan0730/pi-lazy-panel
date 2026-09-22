/**
 * Prompt bar — a one-line text prompt that replaces the footer row.
 *
 *   <label>foo▏                              Enter <ok>  Esc <cancel>
 *
 * Generic building block behind the search bar (`/`). Wraps pi-tui's `Input`
 * so cursor movement, word deletion, paste and the kill-ring come for free.
 * The bar only owns rendering + the input widget; the panel decides what to do
 * on submit / cancel. (Labelling a tree node uses the centered
 * ./input-dialog.ts instead.)
 *
 * 底部一行式输入框：搜索栏用它，只负责画和收键，语义由 app.ts 决定。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, visibleWidth } from "@earendil-works/pi-tui";
import type { KeyHint } from "../../types.ts";
import { fit } from "../frame.ts";

/** One `key description` pair shown at the right end of the bar. */
export type PromptHint = KeyHint;

export interface PromptBarOptions {
	theme: Theme;
	/** Text in front of the input, e.g. "搜索: ". */
	label: string;
	/** Hints rendered after the field; dropped when the terminal is too narrow. */
	hints: PromptHint[];
	onSubmit: (value: string) => void;
	onCancel: () => void;
	/** Called after every keystroke so the panel can re-render. */
	onChange: () => void;
}

export class PromptBar {
	private readonly input: Input;
	private _focused = false;

	constructor(private readonly o: PromptBarOptions) {
		// 前面已经有自己的 label（如 "搜索: "），去掉 pi-tui Input 默认的 "> " 提示符。
		this.input = new Input({ prompt: "" });
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

	/** Reset the field, optionally pre-filled. */
	reset(value = ""): void {
		this.input.setValue(value);
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
		this.o.onChange();
	}

	/** Render the bar as one line of exactly `width`. */
	render(width: number): string[] {
		const { theme } = this.o;
		const label = theme.bold(theme.fg("accent", this.o.label));
		const hint = this.o.hints.map(([k, t]) => `${theme.fg("dim", k)} ${theme.fg("muted", t)}`).join("  ");
		const hintW = visibleWidth(hint);
		const labelW = visibleWidth(this.o.label);
		let inputW = width - labelW - hintW - 2;
		let showHint = hint.length > 0;
		// 太窄就放弃提示，把宽度都留给输入框。
		if (inputW < 10) {
			showHint = false;
			inputW = Math.max(1, width - labelW);
		}
		const field = this.input.render(inputW)[0] ?? "";
		const line = showHint ? `${label}${fit(field, inputW)}  ${hint}` : `${label}${field}`;
		return [fit(line, width)];
	}
}
