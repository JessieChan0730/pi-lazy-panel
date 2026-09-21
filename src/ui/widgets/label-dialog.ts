/**
 * Label dialog (`T` in the tree pane, same as `Shift+T` in pi's `/tree`).
 *
 * A small box centered over the panel, like lazygit's commit-message popup:
 *
 *   ┌─ Label ──────────────────────── user: hi ─┐
 *   │                                            │
 *   │  checkpoint▏                               │
 *   │                                            │
 *   └────────────────────────────────────────────┘
 *    LABEL │ Enter save   Esc cancel   empty removes      <- footer while open
 *
 * Pre-filled with the node's current label (cursor at the end); submitting an
 * empty value clears it. The panel owns the target node and persists the change
 * through the injected actions, this widget only collects the text and draws
 * the box. Key hints go to the footer (see LABEL_DIALOG_HINTS), like lazygit.
 *
 * 居中弹窗版的打标签输入框：包装 pi-tui `Input`，标题右侧显示被打标签的节点；
 * 快捷键提示放在底部 footer（app.ts 用 LABEL_DIALOG_HINTS 渲染），弹窗本身只有输入行。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, truncateToWidth } from "@earendil-works/pi-tui";
import type { KeyHint } from "../../types.ts";
import { frame, metaBudget, overlayCentered } from "../frame.ts";

/** Title on the top border of the box. */
export const LABEL_DIALOG_TITLE = "Label";

/** Footer hints while the dialog is open. */
export const LABEL_DIALOG_HINTS: KeyHint[] = [
	["Enter", "save"],
	["Esc", "cancel"],
	["empty", "removes"],
];

/** Box height: top border, padding, input, padding, bottom border. */
const DIALOG_HEIGHT = 5;

/** Legacy "End" key sequence; pi-tui's `Input` maps it to "move to line end". */
const END_KEY = "\x1b[F";

export interface LabelDialogOptions {
	theme: Theme;
	onSubmit: (value: string) => void;
	onCancel: () => void;
	/** Called after every keystroke so the panel can re-render. */
	onChange: () => void;
}

export class LabelDialog {
	private input: Input;
	private _focused = false;
	/** One-line description of the node being labelled, shown on the title bar. */
	private subject = "";

	constructor(private readonly o: LabelDialogOptions) {
		this.input = this.createInput("");
	}

	/** Focusable propagation (IME cursor): mirrored from the root component. */
	get focused(): boolean {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
		this.input.focused = v;
	}

	/** Start editing: a fresh field pre-filled with `value`, titled with `subject`. */
	open(value: string, subject: string): void {
		this.input = this.createInput(value);
		this.input.focused = this._focused;
		this.subject = subject;
	}

	getValue(): string {
		return this.input.getValue();
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
		this.o.onChange();
	}

	/** Render the box itself, every line exactly `width` columns. */
	render(width: number): string[] {
		const { theme } = this.o;
		const inner = width - 2;
		// 输入行左右各留一列空白，光标不会贴着边框。
		const field = ` ${this.input.render(Math.max(1, inner - 2))[0] ?? ""}`;
		// 标题和节点描述之间至少留 3 个 ─，否则两者会贴在一起。
		const meta = truncateToWidth(this.subject, metaBudget(width, LABEL_DIALOG_TITLE) - 3, "…", false);
		return frame(["", field, ""], {
			width,
			height: DIALOG_HEIGHT,
			title: LABEL_DIALOG_TITLE,
			...(meta ? { meta } : {}),
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
			metaStyle: (s) => theme.fg("dim", s),
		});
	}

	/** Composite the box centered over the already-rendered panel `lines`. */
	overlay(lines: string[], termW: number): string[] {
		const width = dialogWidth(termW);
		return overlayCentered(lines, this.render(width), width, termW);
	}

	/** New input wired to the callbacks; `setValue` leaves the cursor at 0, so move it to the end. */
	private createInput(value: string): Input {
		const input = new Input({ prompt: "" });
		input.onSubmit = (v) => this.o.onSubmit(v);
		input.onEscape = () => this.o.onCancel();
		input.setValue(value);
		if (value) input.handleInput(END_KEY);
		return input;
	}
}

/** Width of the box for a `termW`-column terminal. */
export function dialogWidth(termW: number): number {
	return Math.max(24, Math.min(termW - 4, 60));
}
