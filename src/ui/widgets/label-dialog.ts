/**
 * Label prompt (`T` in the tree pane, same as `Shift+T` in pi's `/tree`):
 * the title and footer hints that ./input-dialog.ts shows while labelling.
 *
 * The panel owns the target node and persists the change through the injected
 * actions; the pre-filled value is the node's current label and an empty
 * submission clears it.
 *
 * 打标签只是通用输入弹窗（InputDialog）的一个预设：这里只放标题和 footer 提示，
 * 其他场景（比如给 session 起名）照此再写一个预设即可。
 */

import type { KeyHint } from "../../types.ts";

/** Title on the top border of the box. */
export const LABEL_DIALOG_TITLE = "Label";

/** Footer hints while the dialog is open. */
export const LABEL_DIALOG_HINTS: KeyHint[] = [
	["Enter", "save"],
	["Esc", "cancel"],
	["empty", "removes"],
];
