/**
 * Confirm dialog: the Yes / No menu shown before every destructive or outbound
 * action (delete, fork, clone, share, import, overwriting an export — CLAUDE.md rule 7).
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
 * 删除 / fork 前的确认框是通用选择菜单（SelectDialog）的一个预设：默认停在 No，
 * y / n 直接选，Enter 确认光标所在项，Esc 取消。这里只放文案、顺序和提示，不做 I/O。
 */

import type { KeyHint } from "../../types.ts";
import type { SelectDialogSpec } from "./select-dialog.ts";

/** Menu entries; `CONFIRM_YES_INDEX` / `CONFIRM_NO_INDEX` name them. */
export const CONFIRM_ITEMS = ["Yes", "No"] as const;
export const CONFIRM_YES_INDEX = 0;
export const CONFIRM_NO_INDEX = 1;

/** Footer hints while a confirmation is open. */
export const CONFIRM_HINTS: KeyHint[] = [
	["y/n", "choose"],
	["Enter", "confirm"],
	["Esc", "cancel"],
];

/** Title of the delete-session confirmation. */
export const DELETE_SESSION_TITLE = "Delete session?";

/** Title of the clone-session confirmation (`y`). */
export const CLONE_SESSION_TITLE = "Clone session?";

/** Title of the fork confirmation, shown after a message is picked (`o`). */
export const FORK_SESSION_TITLE = "Fork session?";

/** Title of the share confirmation (`S`): the session leaves the machine. */
export const SHARE_SESSION_TITLE = "Upload as secret gist?";

/** Title of the import confirmation (`I`), pi's "Replace current session with …?". */
export const IMPORT_SESSION_TITLE = "Import and switch to it?";

/** Title of the confirmation before an export overwrites an existing file (`e`). */
export const OVERWRITE_FILE_TITLE = "Overwrite file?";

export interface ConfirmSpecOptions {
	/** Title on the top border, e.g. "Delete session?". */
	title: string;
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
		items: [...CONFIRM_ITEMS],
		initialIndex: CONFIRM_NO_INDEX,
		...(o.subject ? { subject: o.subject } : {}),
		hints: CONFIRM_HINTS,
		shortcuts: { y: CONFIRM_YES_INDEX, n: CONFIRM_NO_INDEX },
		onSelect: (index) => (index === CONFIRM_YES_INDEX ? o.onConfirm() : o.onCancel()),
		onCancel: o.onCancel,
	};
}
