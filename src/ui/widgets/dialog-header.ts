/** Read-only dialog title bar: keep the close hint visible before optional subject text. */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { t } from "../../i18n/index.ts";
import type { FrameOptions } from "../frame.ts";
import { metaBudget } from "../frame.ts";

/**
 * Key labels of the two ways out of a read-only dialog. `q` is only advertised
 * where it does not type into a field (input / search dialogs stay Esc-only).
 *
 * 只读弹窗的两种退出键；输入框里 q 是正文，只提示 Esc。
 */
export const DIALOG_CLOSE_KEYS = "Esc/q";

/** Used by session info, changelog and settings; compact input and menu dialogs keep their original headers. */
export function dialogHeader(width: number, title: string, subject = ""): Pick<FrameOptions, "title" | "meta"> {
	const hint = dialogCloseHint();
	// 窄屏优先保留退出提示：先缩短标题，再按剩余宽度放说明，避免 frame 把整个 meta 丢掉。
	const fittedTitle = truncateToWidth(title, Math.max(0, metaBudget(width, "") - visibleWidth(hint)), "…", false);
	// 说明与提示之间用 " · " 分隔，标题和右侧信息之间至少留 3 个 ─。
	const subjectWidth = metaBudget(width, fittedTitle) - visibleWidth(hint) - 6;
	const fittedSubject = subjectWidth > 1 ? truncateToWidth(subject, subjectWidth, "…", false) : "";
	return { title: fittedTitle, meta: fittedSubject ? `${fittedSubject} · ${hint}` : hint };
}

/**
 * Right-aligned exit hint of read-only dialogs and menus without a subject of
 * their own (the share flow's pickers): `Esc` and `q` both leave without doing
 * anything.
 */
export function dialogCloseHint(): string {
	return `${DIALOG_CLOSE_KEYS} ${t("hint.close")}`;
}
