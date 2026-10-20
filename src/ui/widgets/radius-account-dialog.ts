/**
 * Radius account menu: `S` → Radius while a credential is stored.
 *
 *   ┌─ Radius ────────────────────────────── alpha ─┐
 *   │ › Share to Radius                              │
 *   │   Sign out of Radius                           │
 *   └────────────────────────────────────────────────┘
 *    SHARE │ j/k move   Enter select   Esc cancel
 *
 * A ./select-dialog.ts preset. Sharing continues exactly like an explicit
 * Radius share; signing out asks once more (./confirm-dialog.ts) because it
 * deletes the credential pi stored. When nothing is stored the flow never
 * opens this menu — it goes straight to the sign-in menus in
 * ./radius-login-dialog.ts.
 *
 * Radius 账号菜单：已登录时 `S` → Radius 先问"分享 / 退出登录"。没登录时不会进这里，
 * 直接进 pi 的登录菜单。只放文案和选项，不做 I/O。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";

/** What the account menu can do. */
export type RadiusAccountAction = "share" | "logout";

/** Title on the top border. */
export function radiusAccountTitle(): string {
	return t("dialog.radiusAccountTitle");
}

/** Entries, top to bottom (sharing first: that is what `S` is for). */
export function radiusAccountActions(): ReadonlyArray<{ action: RadiusAccountAction; label: string }> {
	return [
		{ action: "share", label: t("dialog.radiusAccountShare") },
		{ action: "logout", label: t("dialog.radiusAccountSignOut") },
	];
}

/** Footer hints while the account menu is open. */
export function radiusAccountHints(): KeyHint[] {
	return [
		["j/k", t("hint.move")],
		["Enter", t("hint.select")],
		["Esc", t("hint.cancel")],
	];
}
