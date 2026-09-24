/**
 * Compact prompt (`c` in the sessions pane, what `/compact [instructions]` does):
 * the title and footer hints that ./input-dialog.ts shows while asking for the
 * optional focus instructions, same idea as ./rename-dialog.ts.
 *
 * The panel owns the target session and runs the compaction through the injected
 * actions; the input is optional — an empty submission compacts with pi's default
 * instructions, non-empty text focuses the summary.
 *
 * 压缩会话是通用输入弹窗（InputDialog）的一个预设：标题 + footer 提示；弹窗标题右侧显示
 * 被压缩的会话（首条消息预览），输入可留空（空 = 用 pi 的默认压缩指令）。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";

/** Title on the top border of the box. */
export function compactDialogTitle(): string {
	return t("dialog.compactTitle");
}

/** Footer hints while the dialog is open. */
export function compactDialogHints(): KeyHint[] {
	return [
		["Enter", t("hint.compact")],
		["Esc", t("hint.cancel")],
		[t("hint.emptyKey"), t("hint.compactDefault")],
	];
}
