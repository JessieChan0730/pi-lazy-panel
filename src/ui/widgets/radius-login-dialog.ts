/**
 * Radius sign-in menus (`S` → Radius when no credential is stored): the two
 * choices pi's `/login radius` offers, then pi's OAuth method menu.
 *
 *   ┌─ Radius sign-in ─────────────────────────────── alpha ─┐
 *   │ › Sign in with an account                              │
 *   │   Sign in with an API key                              │
 *   └────────────────────────────────────────────────────────┘
 *   ┌─ Choose how to sign in to Radius ────────────── alpha ─┐
 *   │ › Sign in with browser                                 │
 *   │   Sign in with device code                             │
 *   └────────────────────────────────────────────────────────┘
 *    SHARE │ j/k move   Enter select   Esc cancel
 *
 * Both are ./select-dialog.ts presets. The account path then asks pi's own
 * OAuth question (browser / device code) in the second menu; the API key
 * arrives through ./input-dialog.ts. pi's labels carry parenthetical asides
 * ("(recommended)", "(when signing in from another device)") — the panel
 * shows the plain choice through the i18n keys below. Only text and
 * callbacks — no I/O.
 *
 * Radius 登录方式菜单：账号（OAuth）/ API Key，和 pi 的 `/login radius` 一致。
 * 账号之后 pi 会问浏览器 / 设备码，也用同一个菜单，文案换成面板自己的
 * （pi 原文里括号中的说明不显示）。API Key 用输入框。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint, RadiusLoginMethod } from "../../types.ts";

/** Title on the top border of the account / API-key menu. */
export function radiusLoginTitle(): string {
	return t("dialog.radiusLoginTitle");
}

/** Sign-in choices, top to bottom. */
export function radiusLoginMethods(): ReadonlyArray<{ method: RadiusLoginMethod; label: string }> {
	return [
		{ method: "oauth", label: t("dialog.radiusLoginAccount") },
		{ method: "api_key", label: t("dialog.radiusLoginApiKey") },
	];
}

/** Title of pi's OAuth method menu (browser / device code). */
export function radiusLoginMethodTitle(): string {
	return t("dialog.radiusLoginMethodTitle");
}

/**
 * The panel's label for one of pi's OAuth method ids ("browser" /
 * "device-code"); undefined for an id the panel does not know (pi's own label
 * is then shown as-is). pi's labels include parenthetical explanations, the
 * panel's do not.
 */
export function radiusLoginMethodLabel(id: string): string | undefined {
	if (id === "browser") return t("dialog.radiusLoginBrowser");
	if (id === "device-code") return t("dialog.radiusLoginDeviceCode");
	return undefined;
}

/** Footer hints of the sign-in method menus. */
export function radiusLoginHints(): KeyHint[] {
	return [
		["j/k", t("hint.move")],
		["Enter", t("hint.select")],
		["Esc", t("hint.cancel")],
	];
}

/** Footer hints while an API key / prompt field is open. */
export function radiusPromptHints(): KeyHint[] {
	return [
		["Enter", t("hint.save")],
		["Esc", t("hint.cancel")],
	];
}

/** Footer hints of the device-code notice (copy only when something is copied). */
export function radiusNoticeHints(copy: boolean): KeyHint[] {
	const hints: KeyHint[] = [];
	if (copy) hints.push(["y", t("hint.copy")]);
	hints.push(["Esc", t("hint.cancel")]);
	return hints;
}

/** Title of the box that carries the device code. */
export function radiusDeviceTitle(): string {
	return t("dialog.radiusDeviceTitle");
}

/** "Enter code XXXX" line of the device-code box. */
export function radiusDeviceCode(userCode: string): string {
	return t("dialog.radiusDeviceCode", { code: userCode });
}
