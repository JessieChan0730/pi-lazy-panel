/**
 * Label prompt (`L`, same as `Shift+L` in pi's `/tree`): the title and footer
 * hints that ./input-dialog.ts shows while labelling. The title-bar subject is
 * ./dialog-subject.ts's `nodeSubject` (role · time).
 *
 * The panel owns the target node and persists the change through the injected
 * actions; the pre-filled value is the node's current label and an empty
 * submission clears it.
 *
 * 打标签只是通用输入弹窗（InputDialog）的一个预设：这里只放标题和 footer 提示，
 * 其他场景（比如给 session 起名）照此再写一个预设即可。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";

/** Title on the top border of the box. */
export function labelDialogTitle(): string {
	return t("dialog.labelTitle");
}

/** Footer hints while the dialog is open. */
export function labelDialogHints(): KeyHint[] {
	return [
		["Enter", t("hint.save")],
		["Esc", t("hint.cancel")],
		// 纯文本提示：空键位，说明留空提交时清除该项。
		["", t("hint.removes")],
	];
}
