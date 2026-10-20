/**
 * Share destination menu (`S` in the sessions pane, what pi's `/share` does):
 *
 *   ┌─ Share session ─────────────────────── alpha ─┐
 *   │ › Auto (Gist first)                    │
 *   │   GitHub Gist                                 │
 *   │   Radius                                      │
 *   └───────────────────────────────────────────────┘
 *    SHARE │ j/k move   Enter select   Esc cancel       <- footer while open
 *
 * A ./select-dialog.ts preset: the menu itself is the outbound confirmation
 * (CLAUDE.md rule 7) — Esc leaves without uploading anything. The cursor starts
 * on pi's `sessionShareDestination` (auto when unset) so the panel keeps
 * following pi's setting as a default while still letting each share pick a
 * destination. Missing credentials / tools are reported by the share action in
 * pi's wording (`gh auth login`, `/login radius`); this widget does no I/O.
 *
 * 分享去向菜单：Auto / GitHub Gist / Radius。菜单本身就是外发确认（Esc 不发任何东西）；
 * 初始光标落在 pi 的 `sessionShareDestination` 上（没配置就是 auto），既沿用 pi 的设置，
 * 又允许每次分享临时改。面板的 auto 是 **Gist 优先**，和 pi 内置 /share 的 Radius 优先不同。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint, SessionShareDestination } from "../../types.ts";

/** Title on the top border (localised). */
export function shareTitle(): string {
	return t("dialog.shareTitle");
}

/** Destination order, top to bottom (auto first). */
export const SHARE_DESTINATION_ORDER: readonly SessionShareDestination[] = ["auto", "gist", "radius"];

/** Menu entries, top to bottom, localised. */
export function shareDestinations(): ReadonlyArray<{ destination: SessionShareDestination; label: string }> {
	return [
		{ destination: "auto", label: t("dialog.shareAuto") },
		{ destination: "gist", label: t("dialog.shareGist") },
		{ destination: "radius", label: t("dialog.shareRadius") },
	];
}

/** Footer hints while the menu is open. */
export function shareHints(): KeyHint[] {
	return [
		["j/k", t("hint.move")],
		["Enter", t("hint.select")],
		["Esc", t("hint.cancel")],
	];
}

/** Cursor position for pi's setting (`auto` when it is somehow not in the list). */
export function shareInitialIndex(destination: SessionShareDestination): number {
	return Math.max(0, SHARE_DESTINATION_ORDER.indexOf(destination));
}
