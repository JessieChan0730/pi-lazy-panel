/**
 * Switch-session dialog: the warning shown when Enter (SESSIONS, a double-click,
 * a cross-session TREE restore) would leave a conversation that is still running.
 *
 *   ┌─ Switch session ──────────────────────────┐
 *   │ ! The current conversation is running      │
 *   │   Switching interrupts the task in progress.│
 *   │                                            │
 *   │   Switch to  beta · 11/07                  │
 *   │                                            │
 *   │                    [ Yes ]   › [ No ]      │
 *   └────────────────────────────────────────────┘
 *    CONFIRM │ y/n choose   ←/→ move   Enter confirm   Esc cancel
 *
 * Its own component, unlike the other confirmations (./confirm-dialog.ts, a
 * vertical preset of ./select-dialog.ts): the texts are fixed here and the spec
 * only carries the destination and the callbacks. Yes and No always share one
 * row; the cursor starts on No so a stray Enter never interrupts the run.
 *
 * 切换会话的专用确认框：文案固定，spec 只带目标会话和回调；是 / 否固定左右一行，默认否。
 * 其他确认框（删除 / fork / 导入……）仍是 confirm-dialog.ts 的竖排预设，不受影响。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { matchesKeyId } from "../../config/keys.ts";
import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";
import { clamp } from "../../utils/indices.ts";
import { boxCell, boxContains, centeredRect, dialogWidth, frame, overlayCentered, type BoxRect } from "../frame.ts";
import { CONFIRM_NO_INDEX, CONFIRM_YES_INDEX, confirmItems } from "./confirm-dialog.ts";

export interface SwitchSessionDialogSpec {
	/** The session about to be entered: name · date, or its shortened path. */
	target: string;
	onConfirm: () => void;
	onCancel: () => void;
}

/** Footer hints while the dialog is open. */
export function switchSessionHints(): KeyHint[] {
	return [
		["y/n", t("hint.choose")],
		["←/→", t("hint.move")],
		["Enter", t("hint.confirm")],
		["Esc", t("hint.cancel")],
	];
}

export interface SwitchSessionDialogOptions {
	theme: Theme;
	onChange: () => void;
}

interface Button {
	index: number;
	col: number;
	width: number;
}

export class SwitchSessionDialog {
	private spec: SwitchSessionDialogSpec | undefined;
	private index = CONFIRM_NO_INDEX;
	private boxRect: BoxRect | undefined;
	private buttonRow = 0;
	private buttons: Button[] = [];

	constructor(private readonly o: SwitchSessionDialogOptions) {}

	get isOpen(): boolean {
		return this.spec !== undefined;
	}

	get hints(): KeyHint[] {
		return this.spec ? switchSessionHints() : [];
	}

	get selectedIndex(): number {
		return this.index;
	}

	open(spec: SwitchSessionDialogSpec): void {
		this.spec = spec;
		this.index = CONFIRM_NO_INDEX;
		this.invalidate();
	}

	/** Close without invoking either callback. */
	close(): void {
		this.spec = undefined;
		this.invalidate();
	}

	invalidate(): void {
		this.boxRect = undefined;
		this.buttons = [];
	}

	handleInput(data: string): void {
		const spec = this.spec;
		if (!spec) return;
		if (matchesKeyId(data, "escape")) {
			spec.onCancel();
		} else if (matchesKeyId(data, "n")) {
			this.moveTo(CONFIRM_NO_INDEX);
			this.activate();
		} else if (matchesKeyId(data, "y")) {
			this.moveTo(CONFIRM_YES_INDEX);
			this.activate();
		} else if (matchesKeyId(data, "return")) {
			this.activate();
		} else if (["left", "up", "h", "k"].some((key) => matchesKeyId(data, key))) {
			this.move(-1);
		} else if (["right", "down", "l", "j"].some((key) => matchesKeyId(data, key))) {
			this.move(1);
		}
		// 其他按键全部吞掉，不能落到后面的面板或菜单。
	}

	activate(): void {
		if (this.index === CONFIRM_YES_INDEX) this.spec?.onConfirm();
		else this.spec?.onCancel();
	}

	move(delta: number): void {
		this.moveTo(this.index + delta);
	}

	moveTo(index: number): void {
		if (!this.spec) return;
		const next = clamp(index, CONFIRM_YES_INDEX, CONFIRM_NO_INDEX);
		if (next === this.index) return;
		this.index = next;
		this.o.onChange();
	}

	indexAt(x: number, y: number): number | undefined {
		const cell = this.boxRect ? boxCell(this.boxRect, x, y) : undefined;
		if (!cell || cell.row !== this.buttonRow) return undefined;
		return this.buttons.find((button) => cell.col >= button.col && cell.col < button.col + button.width)?.index;
	}

	wheel(x: number, y: number, delta: number): void {
		if (delta && this.boxRect && boxContains(this.boxRect, x, y)) this.move(delta);
	}

	/** Warning, explanation and destination; they wrap or compact, the button row never does. */
	private introduction(inner: number, maxLines: number): string[] {
		const { theme } = this.o;
		const target = this.spec?.target ?? "";
		const warning = t("confirm.switchRunningWarning");
		const message = t("confirm.switchRunningMessage");
		const indent = "   ";
		const width = Math.max(1, inner - indent.length - 1);
		const detail = target ? `${theme.fg("muted", t("confirm.switchRunningTarget"))}  ${theme.bold(theme.fg("text", target))}` : "";
		const body: string[] = [];
		wrapTextWithAnsi(warning, width).forEach((line, k) => {
			body.push(theme.fg("warning", ` ${k === 0 ? "! " : "  "}${theme.bold(line)}`));
		});
		body.push(...wrapTextWithAnsi(message, width).map((line) => `${indent}${theme.fg("text", line)}`), "");
		if (detail) body.push(...wrapTextWithAnsi(detail, width).map((line) => `${indent}${line}`), "");
		if (body.length <= maxLines) return body;
		// 小窗口优先留住警告和目标，为最后一行的两个按钮预留空间。
		const compact = [theme.fg("warning", ` ! ${theme.bold(truncateToWidth(warning, width, "…", false))}`)];
		if (maxLines >= 3 || !detail) compact.push(`${indent}${theme.fg("text", truncateToWidth(message, width, "…", false))}`);
		if (detail) compact.push(`${indent}${truncateToWidth(detail, width, "…", false)}`);
		return compact.slice(0, maxLines);
	}

	render(width: number, maxHeight = Infinity): string[] {
		if (!this.spec) return [];
		const { theme } = this.o;
		const inner = width - 2;
		const body = this.introduction(inner, Math.max(0, maxHeight - 3));
		const labels = confirmItems().map((item) => `[ ${item} ]`);
		const widths = labels.map((label) => visibleWidth(label) + 2);
		const gap = Math.min(3, Math.max(0, inner - widths.reduce((sum, w) => sum + w, 0) - 2));
		const total = widths.reduce((sum, w) => sum + w, 0) + gap;
		let col = Math.max(0, inner - total - 1);
		let actions = " ".repeat(col);
		this.buttonRow = body.length;
		this.buttons = [];
		labels.forEach((label, index) => {
			const buttonWidth = widths[index]!;
			const selected = index === this.index;
			const button = theme.fg(selected ? "accent" : "text", `${selected ? "› " : "  "}${label}`);
			this.buttons.push({ index, col, width: buttonWidth });
			actions += selected ? theme.bg("selectedBg", button) : button;
			if (index === CONFIRM_YES_INDEX) actions += " ".repeat(gap);
			col += buttonWidth + gap;
		});
		body.push(actions);
		return frame(body, {
			width, height: body.length + 2, title: t("confirm.switchRunning"),
			border: (text) => theme.fg("borderAccent", text),
			titleStyle: (text) => theme.bold(theme.fg("accent", text)),
		});
	}

	overlay(lines: string[], termW: number): string[] {
		const width = dialogWidth(termW);
		const box = this.render(width, lines.length);
		this.boxRect = centeredRect(termW, lines.length, width, box.length);
		return overlayCentered(lines, box, width, termW, (text) => this.o.theme.fg("dim", text), this.boxRect.top);
	}
}
