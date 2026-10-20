/**
 * Notice dialog — a read-only box centered over the panel for something the
 * user has to act on outside the panel, e.g. Radius sign-in:
 *
 *   ┌─ Continue in your browser ─────────────────────┐
 *   │ https://radius.pi.dev/…/authorize?…             │
 *   │ Continue in your browser.                       │
 *   └─────────────────────────────────────────────────┘
 *    SHARE │ y copy   Esc cancel                     <- footer while open
 *
 * Generic like ./input-dialog.ts: title, lines, hints and the callbacks arrive
 * with `open(spec)`. Lines wrap to the box width (URLs are long), so nothing
 * the user needs is truncated. Esc / q call `onClose`; `y` calls `onCopy` when
 * one was given. The widget does no I/O — the flow owns copying and cancel.
 *
 * 通用提示框：给需要用户在面板外操作的信息（Radius 登录的 URL / 设备码）。
 * 过长的行换行显示不截断；只管画和 Esc / q / y 三个键，复制和取消由流程负责。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKeyId } from "../../config/keys.ts";
import type { KeyHint } from "../../types.ts";
import { dialogWidth, frame, overlayCentered } from "../frame.ts";
import { wrapValue } from "./session-info-dialog.ts";

export interface NoticeDialogSpec {
	/** Title on the top border. */
	title: string;
	/** Body lines, top to bottom; a line wider than the box wraps. */
	lines: readonly string[];
	/** Footer hints while this box is open. */
	hints: KeyHint[];
	/** Esc / q: the flow decides whether that also cancels the work behind the box. */
	onClose: () => void;
	/** `y`, when set: the flow copies something useful (the URL / code). */
	onCopy?: () => void;
}

export interface NoticeDialogOptions {
	theme: Theme;
}

export class NoticeDialog {
	private spec: NoticeDialogSpec | undefined;

	constructor(private readonly o: NoticeDialogOptions) {}

	/** True between `open` and `close`. */
	get isOpen(): boolean {
		return this.spec !== undefined;
	}

	/** Footer hints of the current box (empty when closed). */
	get hints(): KeyHint[] {
		return this.spec?.hints ?? [];
	}

	open(spec: NoticeDialogSpec): void {
		this.spec = spec;
	}

	/** Drop the box without firing a callback. */
	close(): void {
		this.spec = undefined;
	}

	handleInput(data: string): void {
		const spec = this.spec;
		if (!spec) return;
		if (matchesKeyId(data, "escape") || matchesKeyId(data, "q")) {
			spec.onClose();
			return;
		}
		if (matchesKeyId(data, "y") && spec.onCopy) {
			spec.onCopy();
			return;
		}
		// 其他按键一律吞掉，不能漏到下面的面板去。
	}

	/** Render the box itself, every line exactly `width` columns. */
	render(width: number): string[] {
		const { theme } = this.o;
		const inner = width - 2;
		const lineWidth = Math.max(1, inner - 1);
		const body = (this.spec?.lines ?? []).flatMap((line) => wrapValue(line, lineWidth).map((part) => ` ${theme.fg("text", part)}`));
		return frame(body, {
			width,
			height: body.length + 2,
			title: this.spec?.title ?? "",
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
		});
	}

	/** Composite the box centered over the already-rendered panel `lines`. */
	overlay(lines: string[], termW: number): string[] {
		const width = dialogWidth(termW);
		return overlayCentered(lines, this.render(width), width, termW, (s) => this.o.theme.fg("dim", s));
	}
}
