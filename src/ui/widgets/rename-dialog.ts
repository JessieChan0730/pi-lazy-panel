/**
 * Rename prompt (`r` in the sessions pane, what `/name` and ctrl+r in pi's
 * `/resume` do): the title and footer hints that ./input-dialog.ts shows while
 * renaming, same idea as ./label-dialog.ts.
 *
 * The panel owns the target session and persists the change through the
 * injected actions; the pre-filled value is the session's current name and an
 * empty submission clears it (the row falls back to its first-message preview).
 *
 * 给会话起名只是通用输入弹窗（InputDialog）的一个预设：标题 + footer 提示；
 * 弹窗标题右侧显示被改名的会话（首条消息预览），空值清除名称。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";

/** Title on the top border of the box. */
export function renameDialogTitle(): string {
	return t("dialog.renameTitle");
}

/** Footer hints while the dialog is open. */
export function renameDialogHints(): KeyHint[] {
	return [
		["Enter", t("hint.save")],
		["Esc", t("hint.cancel")],
		[t("hint.emptyKey"), t("hint.removes")],
	];
}
