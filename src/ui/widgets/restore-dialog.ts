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

import type { KeyHint } from "../../types.ts";

/** What the user picked in the menu. */
export type SummaryChoice = "none" | "summarize" | "custom";

/** Title on the top border of the menu (pi's wording). */
export const SUMMARY_MENU_TITLE = "Summarize branch?";

/** Menu entries in pi's order; the picked index maps to `choice`. */
export const SUMMARY_MENU: ReadonlyArray<{ label: string; choice: SummaryChoice }> = [
	{ label: "No summary", choice: "none" },
	{ label: "Summarize", choice: "summarize" },
	{ label: "Summarize with custom prompt", choice: "custom" },
];

/** Footer hints while the menu is open. */
export const SUMMARY_MENU_HINTS: KeyHint[] = [
	["j/k", "move"],
	["Enter", "select"],
	["Esc", "cancel"],
];

/** Where the menu reopens after Esc in the custom prompt (pi loops back to the selector). */
export const CUSTOM_PROMPT_INDEX = SUMMARY_MENU.findIndex((m) => m.choice === "custom");

/** Title of the custom instructions prompt (pi's wording). */
export const CUSTOM_PROMPT_TITLE = "Custom summarization instructions";

/** Footer hints while the custom prompt is open. */
export const CUSTOM_PROMPT_HINTS: KeyHint[] = [
	["Enter", "summarize"],
	["Esc", "back"],
];
