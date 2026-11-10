/**
 * Confirm dialog: the Yes / No box shown before every destructive or outgoing
 * action (delete, fork, clone, import, overwriting an export — CLAUDE.md rule 7).
 * Sharing (`S`) has its own destination menu instead: ./share-dialog.ts.
 *
 *   ┌─ Delete session? ──────────── FilmRecall ─┐
 *   │                    [ Yes ]   › [ No ]       │
 *   └────────────────────────────────────────────┘
 *    CONFIRM │ y/n choose   Enter confirm   Esc cancel     <- footer while open
 *
 * A standalone component: Yes and No always share one row. The cursor starts
 * on No so a stray Enter never destroys anything; arrows move between buttons,
 * `y` / `n` choose directly, Enter activates the selected button and Esc cancels.
 *
 * 独立的通用确认框：是 / 否固定左右排列，默认否；只处理绘制和交互，不做 I/O。
 * confirmDialogSpec 提供通用键位提示，各流程传入自己的标题、说明和确认 / 取消回调。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { matchesKeyId } from "../../config/keys.ts";
import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";
import { clamp } from "../../utils/indices.ts";
import { boxCell, boxContains, centeredRect, dialogWidth, frame, metaBudget, overlayCentered, type BoxRect } from "../frame.ts";

/** Localised button labels, ordered Yes then No. */
export function confirmItems(): string[] {
	return [t("confirm.yes"), t("confirm.no")];
}
export const CONFIRM_YES_INDEX = 0;
export const CONFIRM_NO_INDEX = 1;

/** Footer hints while a confirmation is open. */
export function confirmHints(): KeyHint[] {
	return [
		["y/n", t("hint.choose")],
		["←/→", t("hint.move")],
		["Enter", t("hint.confirm")],
		["Esc", t("hint.cancel")],
	];
}

/** Title of the delete-session confirmation. */
export function deleteSessionTitle(): string {
	return t("confirm.delete");
}

/** Title of the batch delete confirmation (`d` with a multi-selection). */
export function deleteSessionsTitle(count: number): string {
	return t("confirm.deleteN", { count });
}

/** Title of the clone-session confirmation (`y`). */
export function cloneSessionTitle(): string {
	return t("confirm.clone");
}

/** Title of the fork confirmation, shown after a message is picked (`o`). */
export function forkSessionTitle(): string {
	return t("confirm.fork");
}

/** Title of the import confirmation (`I`), pi's "Replace current session with …?". */
export function importSessionTitle(): string {
	return t("confirm.import");
}

/** Title of the confirmation before an export overwrites an existing file (`e`). */
export function overwriteFileTitle(): string {
	return t("confirm.overwrite");
}

/** Title of the confirmation that clears the Radius credential (`S` → Sign out of Radius). */
export function radiusSignOutTitle(): string {
	return t("confirm.radiusSignOut");
}

/** Warn before switching away from a conversation that is still running. */
export function runningSessionSwitchSpec(subject: string, onConfirm: () => void, onCancel: () => void): ConfirmDialogSpec {
	return confirmDialogSpec({
		title: t("confirm.switchRunning"),
		warning: t("confirm.switchRunningWarning"),
		message: t("confirm.switchRunningMessage"),
		detail: { label: t("confirm.switchRunningTarget"), value: subject },
		onConfirm,
		onCancel,
	});
}

export interface ConfirmSpecOptions {
	/** Title on the top border, e.g. "Delete session?". */
	title: string;
	/** Optional warning heading, using the theme's warning colour. */
	warning?: string;
	/** Optional explanation above the Yes / No choices, wrapped to the dialog width. */
	message?: string;
	/** Optional labelled target in the body, e.g. a destination session. */
	detail?: { label: string; value: string };
	/** What is about to be acted on, shown at the right end of the title bar. */
	subject?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

export interface ConfirmDialogSpec extends ConfirmSpecOptions {
	hints: KeyHint[];
}

/** Shared confirmation spec; button order and the safe default belong to the component. */
export function confirmDialogSpec(o: ConfirmSpecOptions): ConfirmDialogSpec {
	return { ...o, hints: confirmHints() };
}

export interface ConfirmDialogOptions {
	theme: Theme;
	onChange: () => void;
}

interface ConfirmButton {
	index: number;
	col: number;
	width: number;
}

export class ConfirmDialog {
	private spec: ConfirmDialogSpec | undefined;
	private index = CONFIRM_NO_INDEX;
	private boxRect: BoxRect | undefined;
	private buttonRow = 0;
	private buttons: ConfirmButton[] = [];

	constructor(private readonly o: ConfirmDialogOptions) {}

	get isOpen(): boolean {
		return this.spec !== undefined;
	}

	get hints(): KeyHint[] {
		return this.spec?.hints ?? [];
	}

	get selectedIndex(): number {
		return this.index;
	}

	open(spec: ConfirmDialogSpec): void {
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

	/** Read-only content can wrap or compact; the action row always stays horizontal. */
	private introduction(inner: number, maxLines: number): string[] {
		const { theme } = this.o;
		const spec = this.spec;
		const body: string[] = [];
		const indent = spec?.warning ? "   " : " ";
		const width = Math.max(1, inner - indent.length - 1);
		const detail = spec?.detail?.value ? `${theme.fg("muted", spec.detail.label)}  ${theme.bold(theme.fg("text", spec.detail.value))}` : "";
		if (spec?.warning) {
			wrapTextWithAnsi(spec.warning, width).forEach((line, k) => {
				body.push(theme.fg("warning", ` ${k === 0 ? "! " : "  "}${theme.bold(line)}`));
			});
		}
		if (spec?.message) body.push(...wrapTextWithAnsi(spec.message, width).map((line) => `${indent}${theme.fg("text", line)}`));
		if (body.length) body.push("");
		if (detail) body.push(...wrapTextWithAnsi(detail, width).map((line) => `${indent}${line}`), "");
		if (body.length <= maxLines) return body;
		// 小窗口优先留住警告和目标，为最后一行的两个按钮预留空间。
		const compact: string[] = [];
		if (spec?.warning) compact.push(theme.fg("warning", ` ! ${theme.bold(truncateToWidth(spec.warning, width, "…", false))}`));
		if (spec?.message && (maxLines >= 3 || !detail)) compact.push(`${indent}${theme.fg("text", truncateToWidth(spec.message, width, "…", false))}`);
		if (detail) compact.push(`${indent}${truncateToWidth(detail, width, "…", false)}`);
		return compact.slice(0, maxLines);
	}

	render(width: number, maxHeight = Infinity): string[] {
		const spec = this.spec;
		if (!spec) return [];
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
			const marker = selected ? "› " : "  ";
			const button = theme.fg(selected ? "accent" : "text", `${marker}${label}`);
			this.buttons.push({ index, col, width: buttonWidth });
			actions += selected ? theme.bg("selectedBg", button) : button;
			if (index === CONFIRM_YES_INDEX) actions += " ".repeat(gap);
			col += buttonWidth + gap;
		});
		body.push(actions);
		const meta = truncateToWidth(spec.subject ?? "", metaBudget(width, spec.title) - 3, "…", false);
		return frame(body, {
			width, height: body.length + 2, title: spec.title,
			...(meta ? { meta } : {}),
			border: (text) => theme.fg("borderAccent", text),
			titleStyle: (text) => theme.bold(theme.fg("accent", text)),
			metaStyle: (text) => theme.fg("dim", text),
		});
	}

	overlay(lines: string[], termW: number): string[] {
		const width = dialogWidth(termW);
		const box = this.render(width, lines.length);
		this.boxRect = centeredRect(termW, lines.length, width, box.length);
		return overlayCentered(lines, box, width, termW, (text) => this.o.theme.fg("dim", text), this.boxRect.top);
	}
}
