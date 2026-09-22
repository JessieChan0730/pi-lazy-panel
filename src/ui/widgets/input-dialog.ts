/**
 * Input dialog — a one-line text field in a box centered over the panel,
 * like lazygit's commit-message popup:
 *
 *   ┌─ Label ──────────────────────── user: hi ─┐
 *   │ checkpoint▏                                │
 *   └────────────────────────────────────────────┘
 *    LABEL │ Enter save   Esc cancel   empty removes      <- footer while open
 *
 * Generic: the caller passes a title, the pre-filled value, an optional
 * subject for the title bar and the callbacks on each `open`, so the same
 * widget serves node labels (`T`), session renames and any later prompt. The
 * dialog only collects text and draws the box; key hints go to the footer
 * (see `hints`), like lazygit.
 *
 * 通用的居中单行输入弹窗：包装 pi-tui `Input`，标题 / 预填值 / 右上角说明 / 回调都在 open 时传入，
 * 打标签、给 session 起名等场景共用同一个组件；快捷键提示由 app.ts 放在底部 footer。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, truncateToWidth } from "@earendil-works/pi-tui";
import type { KeyHint } from "../../types.ts";
import { frame, metaBudget, overlayCentered } from "../frame.ts";

/** Box height: top border, input, bottom border. */
export const INPUT_DIALOG_HEIGHT = 3;

/** Legacy "End" key sequence; pi-tui's `Input` maps it to "move to line end". */
const END_KEY = "\x1b[F";

/** What one prompt looks like; passed to `open`. */
export interface InputDialogSpec {
	/** Title on the top border, e.g. "Label" / "Rename". */
	title: string;
	/** Pre-filled text; the cursor starts at its end. */
	value?: string;
	/** One-line description shown at the right end of the title bar (e.g. the node being labelled). */
	subject?: string;
	/** Footer hints while this prompt is open. */
	hints: KeyHint[];
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

export interface InputDialogOptions {
	theme: Theme;
	/** Called after every keystroke so the panel can re-render. */
	onChange: () => void;
}

export class InputDialog {
	private input: Input;
	private spec: InputDialogSpec | undefined;
	private _focused = false;

	constructor(private readonly o: InputDialogOptions) {
		this.input = new Input({ prompt: "" });
	}

	/** Focusable propagation (IME cursor): mirrored from the root component. */
	get focused(): boolean {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
		this.input.focused = v;
	}

	/** True between `open` and `close`. */
	get isOpen(): boolean {
		return this.spec !== undefined;
	}

	/** Footer hints of the current prompt (empty when closed). */
	get hints(): KeyHint[] {
		return this.spec?.hints ?? [];
	}

	/** Start a prompt: a fresh field pre-filled with `spec.value`. */
	open(spec: InputDialogSpec): void {
		this.spec = spec;
		this.input = this.createInput(spec.value ?? "");
		this.input.focused = this._focused;
	}

	/** Drop the current prompt without firing a callback. */
	close(): void {
		this.spec = undefined;
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
		const title = this.spec?.title ?? "";
		const inner = width - 2;
		// 输入行左侧留一列空白，光标不会贴着边框。
		const field = ` ${this.input.render(Math.max(1, inner - 2))[0] ?? ""}`;
		// 标题和说明之间至少留 3 个 ─，否则两者会贴在一起。
		const meta = truncateToWidth(this.spec?.subject ?? "", metaBudget(width, title) - 3, "…", false);
		return frame([field], {
			width,
			height: INPUT_DIALOG_HEIGHT,
			title,
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

	/** New input wired to the current spec; `setValue` leaves the cursor at 0, so move it to the end. */
	private createInput(value: string): Input {
		const input = new Input({ prompt: "" });
		// 回调走 this.spec，而不是捕获当时的 spec：open 换了 spec 后旧 Input 也不会再被用到。
		input.onSubmit = (v) => this.spec?.onSubmit(v);
		input.onEscape = () => this.spec?.onCancel();
		input.setValue(value);
		if (value) input.handleInput(END_KEY);
		return input;
	}
}

/** Width of the box for a `termW`-column terminal. */
export function dialogWidth(termW: number): number {
	return Math.max(24, Math.min(termW - 4, 60));
}
