/** Read-only dialog title bar: keep the Escape hint visible before optional subject text. */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { t } from "../../i18n/index.ts";
import type { FrameOptions } from "../frame.ts";
import { metaBudget } from "../frame.ts";

/** Used by session info and changelog only; compact input and menu dialogs keep their original headers. */
export function dialogHeader(width: number, title: string, subject = ""): Pick<FrameOptions, "title" | "meta"> {
	const hint = `Esc ${t("hint.close")}`;
	// 窄屏优先保留退出提示：先缩短标题，再按剩余宽度放说明，避免 frame 把整个 meta 丢掉。
	const fittedTitle = truncateToWidth(title, Math.max(0, metaBudget(width, "") - visibleWidth(hint)), "…", false);
	// 说明与提示之间用 " · " 分隔，标题和右侧信息之间至少留 3 个 ─。
	const subjectWidth = metaBudget(width, fittedTitle) - visibleWidth(hint) - 6;
	const fittedSubject = subjectWidth > 1 ? truncateToWidth(subject, subjectWidth, "…", false) : "";
	return { title: fittedTitle, meta: fittedSubject ? `${fittedSubject} · ${hint}` : hint };
}
