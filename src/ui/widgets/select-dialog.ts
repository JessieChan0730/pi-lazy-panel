/**
 * Select dialog — a short menu in a box centered over the panel, like
 * lazygit's menus and pi's "Summarize branch?" selector:
 *
 *   ┌─ Summarize branch? ──────────── assistant: hi ─┐
 *   │ › No summary                                    │
 *   │   Summarize                                     │
 *   │   Summarize with custom prompt                  │
 *   └────────────────────────────────────────────────┘
 *    RESTORE │ j/k move   Enter select   Esc cancel       <- footer while open
 *
 * Generic like ./input-dialog.ts: title, items, initial cursor, subject and
 * the callbacks arrive with `open(spec)`, so the same widget serves the
 * summary menu now and delete confirmations, sort pickers and so on later.
 * Keys: j / k / ↑ / ↓ move, Enter confirms, Esc cancels; everything else is
 * swallowed. Key hints go to the footer (see `hints`).
 *
 * 通用的居中选择菜单：标题 / 选项 / 初始光标 / 回调都在 open 时传入，本身不做 I/O；
 * 快捷键提示由 app.ts 放在底部 footer。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { matchesKeyId } from "../../config/keys.ts";
import type { KeyHint } from "../../types.ts";
import { dialogWidth, fit, frame, metaBudget, overlayCentered } from "../frame.ts";

/** What one menu looks like; passed to `open`. */
export interface SelectDialogSpec {
	/** Title on the top border, e.g. "Summarize branch?". */
	title: string;
	/** Menu entries, top to bottom. */
	items: string[];
	/** Cursor position when the menu opens (clamped into `items`). */
	initialIndex?: number;
	/** One-line description shown at the right end of the title bar (e.g. the node being restored to). */
	subject?: string;
	/** Footer hints while this menu is open. */
	hints: KeyHint[];
	/** Enter: the index of the highlighted entry. */
	onSelect: (index: number) => void;
	onCancel: () => void;
}

export interface SelectDialogOptions {
	theme: Theme;
	/** Called after every cursor move so the panel can re-render. */
	onChange: () => void;
}

export class SelectDialog {
	private spec: SelectDialogSpec | undefined;
	private index = 0;

	constructor(private readonly o: SelectDialogOptions) {}

	/** True between `open` and `close`. */
	get isOpen(): boolean {
		return this.spec !== undefined;
	}

	/** Footer hints of the current menu (empty when closed). */
	get hints(): KeyHint[] {
		return this.spec?.hints ?? [];
	}

	/** Index of the highlighted entry. */
	get selectedIndex(): number {
		return this.index;
	}

	/** Start a menu with the cursor on `spec.initialIndex` (default: the first entry). */
	open(spec: SelectDialogSpec): void {
		this.spec = spec;
		this.index = clamp(spec.initialIndex ?? 0, 0, spec.items.length - 1);
	}

	/** Drop the current menu without firing a callback. */
	close(): void {
		this.spec = undefined;
	}

	handleInput(data: string): void {
		const spec = this.spec;
		if (!spec) return;
		if (matchesKeyId(data, "escape")) {
			spec.onCancel();
			return;
		}
		if (matchesKeyId(data, "return")) {
			if (spec.items.length) spec.onSelect(this.index);
			return;
		}
		if (matchesKeyId(data, "j") || matchesKeyId(data, "down")) this.move(1);
		else if (matchesKeyId(data, "k") || matchesKeyId(data, "up")) this.move(-1);
		// 其他按键一律吞掉，不能漏到下面的面板去。
	}

	private move(delta: number): void {
		const items = this.spec?.items ?? [];
		const next = clamp(this.index + delta, 0, items.length - 1);
		if (next === this.index) return;
		this.index = next;
		this.o.onChange();
	}

	/** Render the box itself: one row per entry plus the borders, every line exactly `width` columns. */
	render(width: number): string[] {
		const { theme } = this.o;
		const title = this.spec?.title ?? "";
		const items = this.spec?.items ?? [];
		const inner = width - 2;
		const body = items.map((item, i) => {
			const selected = i === this.index;
			// 选中行：accent 色的 › 标记 + 整行选中背景，和三个面板里的光标行一致。
			const marker = selected ? "› " : "  ";
			const line = ` ${theme.fg("accent", marker)}${selected ? theme.fg("accent", item) : theme.fg("text", item)}`;
			return selected ? theme.bg("selectedBg", fit(line, inner)) : line;
		});
		const meta = truncateToWidth(this.spec?.subject ?? "", metaBudget(width, title) - 3, "…", false);
		return frame(body, {
			width,
			height: items.length + 2,
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
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}
