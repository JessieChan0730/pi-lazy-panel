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
 * widget serves node labels (`L`), session renames and any later prompt. The
 * dialog only collects text and draws the box; key hints go to the footer
 * (see `hints`), like lazygit. With `capture` the field is not typed into at
 * all: it records key presses, which is how the settings page rebinds actions.
 *
 * 通用的居中单行输入弹窗：包装 pi-tui `Input`，标题 / 预填值 / 右上角说明 / 回调都在 open 时传入，
 * 打标签、给 session 起名等场景共用同一个组件；快捷键提示由 app.ts 放在底部 footer。
 * 传 `capture` 时改成按键录入（设置页改键位用），不打字。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, truncateToWidth } from "@earendil-works/pi-tui";
import { chordFromKeypress, chordLabel, isReservedKey, matchesKeyId } from "../../config/keys.ts";
import type { KeyHint } from "../../types.ts";
import { dialogWidth, frame, metaBudget, overlayCentered } from "../frame.ts";

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
	/** Dimmed text shown while the field is empty (e.g. "Press a key…"). */
	placeholder?: string;
	/** One-line description shown at the right end of the title bar (e.g. the node being labelled). */
	subject?: string;
	/** Footer hints while this prompt is open. */
	hints: KeyHint[];
	/** Optional percentage/number editor: arrows step by one, invalid input stays open. */
	numeric?: { min: number; max: number; error: string };
	/** Optional validation on Enter; returning a message keeps the prompt open and shows it. */
	validate?: (value: string) => string | undefined;
	/**
	 * Key recorder instead of a text field: the user presses the keys to bind
	 * (see `InputDialog.handleInput`), and `onSubmit` receives the chord text
	 * ("ctrl+d", or "g g" for a multi-key sequence). Used by the settings
	 * keybindings page.
	 */
	capture?: boolean;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

/** Decimal input only; blank, partial and out-of-range values remain editable. */
export function numericInputValue(text: string, min: number, max: number): number | undefined {
	const value = text.trim();
	if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return undefined;
	const number = Number(value);
	return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
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
	private error: string | undefined;
	/** Keys recorded so far in `capture` mode, as canonical key ids ("ctrl+d", "g", "g"). */
	private steps: string[] = [];

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
		this.error = undefined;
		this.steps = [];
		this.input = this.createInput(spec.value ?? "");
		this.input.focused = this._focused;
	}

	/** Drop the current prompt without firing a callback. */
	close(): void {
		this.spec = undefined;
		this.steps = [];
	}

	getValue(): string {
		return this.input.getValue();
	}

	handleInput(data: string): void {
		if (!this.spec) return;
		this.error = undefined;
		if (this.spec.capture) {
			this.recordKey(data);
			return;
		}
		const numeric = this.spec.numeric;
		if (numeric && (matchesKeyId(data, "left") || matchesKeyId(data, "right"))) {
			const value = numericInputValue(this.input.getValue(), numeric.min, numeric.max);
			if (value === undefined) this.error = numeric.error;
			else {
				const next = Math.max(numeric.min, Math.min(numeric.max, Number((value + (matchesKeyId(data, "left") ? -1 : 1)).toPrecision(15))));
				this.input.setValue(String(next));
				this.input.handleInput(END_KEY);
			}
		} else this.input.handleInput(data);
		this.o.onChange();
	}

	/**
	 * 按键录入（`spec.capture`）：每按一个键就追加成序列的一步，字段里显示已录入的键。
	 * Esc 取消、Backspace 退回一步 —— 这两个都是面板保留键（见 keys.ts 的 RESERVED_KEYS），
	 * 永远录不进去，所以没有可退的步骤时 Backspace 什么都不做。
	 * 已经有按键时 Enter 保存；序列为空时 Enter 按普通键录入，这样 enter 自己也能绑。
	 * 认不出的输入（粘贴、按键释放、长按重复）直接忽略，继续等下一个键。
	 */
	private recordKey(data: string): void {
		const spec = this.spec;
		if (!spec) return;
		// Esc 先当取消，不管下面能不能解析出 chord。
		if (matchesKeyId(data, "escape")) {
			spec.onCancel();
			return;
		}
		const chord = chordFromKeypress(data);
		if (chord === undefined) return;
		if (isReservedKey(chord)) {
			// Backspace 只用来退回上一步，没有可退的就什么都不做。
			if (chord !== "backspace" || !this.steps.length) return;
			this.steps.pop();
		} else if (this.steps.length && (chord === "enter" || chord === "return")) {
			spec.onSubmit(this.steps.join(" "));
			return;
		} else this.steps.push(chord);
		this.showSteps();
		this.o.onChange();
	}

	/** Mirror the recorded keys into the field (display only; `onSubmit` gets the raw chord text). */
	private showSteps(): void {
		const text = this.steps.length ? chordLabel(this.steps.join(" ")) : "";
		this.input.setValue(text);
		if (text) this.input.handleInput(END_KEY);
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
		return frame([field, ...(this.error ? [theme.fg("error", ` ${this.error}`)] : [])], {
			width,
			height: INPUT_DIALOG_HEIGHT + (this.error ? 1 : 0),
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
		return overlayCentered(lines, this.render(width), width, termW, (s) => this.o.theme.fg("dim", s));
	}

	/** New input wired to the current spec; `setValue` leaves the cursor at 0, so move it to the end. */
	private createInput(value: string): Input {
		const placeholder = this.spec?.placeholder;
		const input = new Input({ prompt: "", ...(placeholder ? { placeholder, placeholderStyle: (text: string) => this.o.theme.fg("dim", text) } : {}) });
		// 回调走 this.spec，而不是捕获当时的 spec：open 换了 spec 后旧 Input 也不会再被用到。
		input.onSubmit = (v) => {
			const numeric = this.spec?.numeric;
			if (numeric && numericInputValue(v, numeric.min, numeric.max) === undefined) {
				this.error = numeric.error;
				return;
			}
			const validationError = this.spec?.validate?.(v);
			if (validationError) {
				this.error = validationError;
				return;
			}
			this.spec?.onSubmit(v);
		};
		input.onEscape = () => this.spec?.onCancel();
		input.setValue(value);
		if (value) input.handleInput(END_KEY);
		return input;
	}
}
