/**
 * Import prompt (`I` in the sessions pane, what pi's `/import` does): the title
 * and footer hints ./input-dialog.ts shows while asking for a session JSONL.
 *
 * After Enter the panel asks for confirmation (./confirm-dialog.ts, like pi's
 * "Replace current session with …?"), then the actions layer copies the file
 * into the session directory and switches pi to it; the panel closes.
 *
 * 导入只是通用输入弹窗（InputDialog）的一个预设：输入 JSONL 路径（相对路径按 pi 的工作目录、
 * 支持 ~），回车后确认，再复制进会话目录并切过去。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";

/** Title on the top border of the box. */
export function importDialogTitle(): string {
	return t("dialog.importTitle");
}

/** Right end of the title bar: what the prompt wants. */
export function importDialogSubject(): string {
	return t("dialog.importSubject");
}

/** Footer hints while the dialog is open. */
export function importDialogHints(): KeyHint[] {
	return [
		["Enter", t("hint.import")],
		["Esc", t("hint.cancel")],
	];
}
