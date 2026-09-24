/**
 * Restore presets (`Enter` in the tree pane, same flow as pi's `/tree`): the
 * "Summarize branch?" menu shown through ./select-dialog.ts and the custom
 * instructions prompt shown through ./input-dialog.ts.
 *
 * The panel owns the target node and hands the choice to the injected
 * actions as `RestoreOptions`; this module only holds the wording, the order
 * of the entries and the footer hints.
 *
 * TREE Enter 的两个弹窗都是通用组件的预设：三选菜单（No summary / Summarize /
 * Summarize with custom prompt，和 pi 内置 /tree 的顺序一致）和自定义摘要指令的输入框。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";

/** What the user picked in the menu. */
export type SummaryChoice = "none" | "summarize" | "custom";

/** Menu choices in pi's order; the picked index maps to `choice`. */
export const SUMMARY_CHOICES: readonly SummaryChoice[] = ["none", "summarize", "custom"];

/** Title on the top border of the menu (pi's wording, localised). */
export function summaryMenuTitle(): string {
	return t("dialog.restoreMenuTitle");
}

/** Menu entries in pi's order, localised; the picked index maps to `choice`. */
export function summaryMenu(): ReadonlyArray<{ label: string; choice: SummaryChoice }> {
	return [
		{ label: t("dialog.restoreNone"), choice: "none" },
		{ label: t("dialog.restoreSummarize"), choice: "summarize" },
		{ label: t("dialog.restoreCustom"), choice: "custom" },
	];
}

/** Footer hints while the menu is open. */
export function summaryMenuHints(): KeyHint[] {
	return [
		["j/k", t("hint.move")],
		["Enter", t("hint.select")],
		["Esc", t("hint.cancel")],
	];
}

/** Where the menu reopens after Esc in the custom prompt (pi loops back to the selector). */
export const CUSTOM_PROMPT_INDEX = SUMMARY_CHOICES.indexOf("custom");

/** Title of the custom instructions prompt (pi's wording, localised). */
export function customPromptTitle(): string {
	return t("dialog.restoreCustomTitle");
}

/** Footer hints while the custom prompt is open. */
export function customPromptHints(): KeyHint[] {
	return [
		["Enter", t("hint.summarize")],
		["Esc", t("hint.back")],
	];
}
