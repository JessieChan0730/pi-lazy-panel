/**
 * Fork selector (`o` in the sessions pane, what pi's `/fork` shows): the title
 * and footer hints for the centered menu of user messages to fork before.
 *
 * Like ./restore-dialog.ts, this is only the wording for a ./select-dialog.ts
 * preset — the panel builds the item list from the session's fork points, the
 * confirmation (./confirm-dialog.ts) then guards the actual fork.
 *
 * fork 选择器只是通用选择菜单（SelectDialog，带滚动窗口）的一个预设：标题 + 提示。
 * 选项来自会话里的 user 消息（app 层从 data 拿），默认停在最后一条（pi 的默认）。
 */

import type { KeyHint } from "../../types.ts";

/** Title on the top border of the fork selector. */
export const FORK_DIALOG_TITLE = "Fork before which message?";

/** Footer hints while the fork selector is open. */
export const FORK_DIALOG_HINTS: KeyHint[] = [
	["j/k", "move"],
	["Enter", "select"],
	["Esc", "cancel"],
];
