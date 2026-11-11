/**
 * Confirm dialog: the Yes / No menu shown before every destructive or outgoing
 * action (delete, fork, clone, import, overwriting an export — CLAUDE.md rule 7).
 * Sharing (`S`) has its own destination menu instead: ./share-dialog.ts.
 *
 *   ┌─ Delete session? ──────────── FilmRecall ─┐
 *   │   Yes                                      │
 *   │ › No                                       │
 *   └────────────────────────────────────────────┘
 *    CONFIRM │ y/n choose   Enter confirm   Esc cancel     <- footer while open
 *
 * A preset of ./select-dialog.ts, like ./restore-dialog.ts: the cursor starts
 * on No so a stray Enter never destroys anything, `y` / `n` pick directly,
 * Enter confirms the highlighted entry and Esc cancels.
 *
 * Leaving a conversation that is still running is the same box with its two
 * entries spelled out (`labels`): "Yes" alone would not say that the running
 * conversation gets interrupted, and the destination sits in the title bar
 * like every other subject.
 *
 *   ┌─ Switch session? ─────────────────────── beta · 11/07 ─┐
 *   │   Switch and interrupt the running conversation!        │
 *   │ › Stay in the current session                           │
 *   └─────────────────────────────────────────────────────────┘
 *
 * 删除 / fork 前的确认框是通用选择菜单（SelectDialog）的一个预设：默认停在 No，
 * y / n 直接选，Enter 确认光标所在项，Esc 取消。这里只放文案、顺序和提示，不做 I/O。
 * 运行中切换会话也是这个确认框，只是把 是 / 否 换成写明后果的两项（labels）：
 * 不需要额外的说明段落，位置、按键、鼠标和其他确认框完全一样。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";
import type { SelectDialogSpec } from "./select-dialog.ts";

/** Menu entries, localised; `CONFIRM_YES_INDEX` / `CONFIRM_NO_INDEX` name them. */
export function confirmItems(): string[] {
	return [t("confirm.yes"), t("confirm.no")];
}
export const CONFIRM_YES_INDEX = 0;
export const CONFIRM_NO_INDEX = 1;

/** Footer hints while a confirmation is open. */
export function confirmHints(): KeyHint[] {
	return [
		["y/n", t("hint.choose")],
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

/** Title of the confirmation before Enter leaves a conversation that is still running. */
export function switchSessionTitle(): string {
	return t("confirm.switchRunning");
}

/**
 * Its two entries: they say what each choice does, because "Yes" would not
 * tell that switching interrupts the running conversation.
 */
export function switchSessionLabels(): ConfirmLabels {
	return { confirm: t("confirm.switchRunningInterrupt"), cancel: t("confirm.switchRunningStay") };
}

/** Wording that replaces Yes / No; same positions, keys and default cursor. */
export interface ConfirmLabels {
	/** The entry that goes ahead (`y`). */
	confirm: string;
	/** The entry that changes nothing (`n`; the cursor starts here). */
	cancel: string;
}

export interface ConfirmSpecOptions {
	/** Title on the top border, e.g. "Delete session?". */
	title: string;
	/** Entries to show instead of Yes / No, when they have to say what happens (see `switchSessionLabels`). */
	labels?: ConfirmLabels;
	/** What is about to be acted on, shown at the right end of the title bar. */
	subject?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

/**
 * The `SelectDialog.open` spec of a confirmation: Yes / No with the cursor on
 * No; picking No is the same as Esc.
 */
export function confirmDialogSpec(o: ConfirmSpecOptions): SelectDialogSpec {
	return {
		title: o.title,
		// 顺序和 confirmItems() 一致：CONFIRM_YES_INDEX 在上，CONFIRM_NO_INDEX 在下。
		items: o.labels ? [o.labels.confirm, o.labels.cancel] : confirmItems(),
		initialIndex: CONFIRM_NO_INDEX,
		...(o.subject ? { subject: o.subject } : {}),
		hints: confirmHints(),
		shortcuts: { y: CONFIRM_YES_INDEX, n: CONFIRM_NO_INDEX },
		onSelect: (index) => (index === CONFIRM_YES_INDEX ? o.onConfirm() : o.onCancel()),
		onCancel: o.onCancel,
	};
}
