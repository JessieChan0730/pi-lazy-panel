/**
 * New-session prompt (`n` in the sessions pane, what `/new` does): the title and
 * footer hints ./input-dialog.ts shows while naming a new session, same idea as
 * ./rename-dialog.ts.
 *
 * The name is optional — an empty submission starts an unnamed session (pi's
 * `/name` [name] argument is left unset). The panel starts the session through
 * the injected actions and closes.
 *
 * 新建会话只是通用输入弹窗（InputDialog）的一个预设：标题 + 提示；名字可留空
 * （对应 /name 的可选 [name] 参数，空则不设置），回车新建并关闭面板。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";

/** Title on the top border of the box. */
export function newSessionDialogTitle(): string {
	return t("dialog.newTitle");
}

/** Footer hints while the dialog is open. */
export function newSessionDialogHints(): KeyHint[] {
	return [
		["Enter", t("hint.create")],
		["Esc", t("hint.cancel")],
		[t("hint.emptyKey"), t("hint.noName")],
	];
}
