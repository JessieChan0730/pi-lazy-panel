/**
 * Radius sign-in menu (`S` → Radius when no credential is stored): the two
 * choices pi's `/login radius` offers.
 *
 *   ┌─ Sign in to Radius ───────────────────── alpha ─┐
 *   │ › Sign in with an account                      │
 *   │   Sign in with an API key                      │
 *   └────────────────────────────────────────────────┘
 *    SHARE │ j/k move   Enter select   Esc cancel
 *
 * A ./select-dialog.ts preset. The account path then asks pi's own OAuth
 * question (browser / device code) in the same menu; the API key arrives
 * through ./input-dialog.ts. Only text and callbacks — no I/O.
 *
 * Radius 登录方式菜单：账号（OAuth）/ API Key，和 pi 的 `/login radius` 一致。
 * 之后账号走 pi 自己的浏览器 / 设备码选择（同一个菜单），API Key 用输入框。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint, RadiusLoginMethod } from "../../types.ts";

/** Title on the top border. */
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

/** Footer hints of the sign-in method menu. */
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

/** Footer hints of the browser / device-code notice (copy only when something is copied). */
export function radiusNoticeHints(copy: boolean): KeyHint[] {
	const hints: KeyHint[] = [];
	if (copy) hints.push(["y", t("hint.copy")]);
	hints.push(["Esc", t("hint.cancel")]);
	return hints;
}

/** Title of the box shown while the browser is waiting for the callback. */
export function radiusBrowserTitle(): string {
	return t("dialog.radiusBrowserTitle");
}

/** Title of the box that carries the device code. */
export function radiusDeviceTitle(): string {
	return t("dialog.radiusDeviceTitle");
}

/** "Enter code XXXX" line of the device-code box. */
export function radiusDeviceCode(userCode: string): string {
	return t("dialog.radiusDeviceCode", { code: userCode });
}
