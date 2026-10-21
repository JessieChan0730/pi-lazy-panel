/**
 * Title-bar subjects of the centered dialogs.
 *
 * A dialog is at most 60 columns wide and the title takes part of the top
 * border, so the right end has room for roughly 30–40 cells. Free text put
 * there — a message body, a session's first-message preview — is cut to a
 * meaningless "…" and only repeats what the pane / tree row already said.
 * These helpers return a short structured identity instead, so the subject
 * always fits and always says which thing the action is about.
 *
 * 弹窗标题栏右侧的“作用对象”标识：树节点用 `角色 · 时间`，会话用 `名字（或模型）· 更新日期`。
 * 不放会被截断的正文 / 首条消息预览——列表行和 TREE 行已经展示过内容了。
 */

import { t } from "../../i18n/index.ts";
import type { SessionRow, TreeRow } from "../../types.ts";
import { formatShortDate, formatTime } from "../../utils/format.ts";

/** Tree node subject: role · time (never its text). Used by Label and the restore menus. */
export function nodeSubject(row: TreeRow): string {
	return `${t(`role.${row.role}`)} · ${formatTime(row.timestamp)}`;
}

/**
 * Session subject: the user-given name (else the last model) · update date,
 * never the first-message preview. Empty when the row has neither.
 */
export function sessionSubject(row: SessionRow): string {
	const label = row.name?.trim() || row.model || "";
	return [label, formatShortDate(row.updatedAt)].filter(Boolean).join(" · ");
}
