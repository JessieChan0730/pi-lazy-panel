/**
 * Cursor row tones: the row under the cursor is painted with `selectedBg` (see
 * the panes), and pi themes pick that background only a shade away from the
 * one they assume underneath — `dark`'s `#3a3a4a` is 1.6:1 against its own
 * canvas and 1.9:1 against a black terminal. Secondary text drawn on top of it
 * (`dim` timestamps, off-branch tree text) then lands at about the same
 * contrast as the background itself and disappears.
 *
 * Stepping every tone one notch brighter on the cursor row fixes that without
 * leaving the theme: `dim` -> `muted`, `muted` -> `text`. The row keeps its own
 * hierarchy (marker and title stay the brightest) and reads crisper than its
 * neighbours on any terminal background, whatever the theme's polarity.
 *
 * 光标行整行刷 selectedBg，而主题的 selectedBg 本来就只和它假设的底色差一档，
 * 落在上面的 dim / muted 文字会跟着糊掉（时间戳、旁支行几乎看不见）。光标行统一提亮一档。
 */

import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/** Tone to paint `color` in on a row: one notch brighter on the cursor row, unchanged elsewhere. */
export function cursorTone(color: ThemeColor, isCursor: boolean): ThemeColor {
	if (!isCursor) return color;
	if (color === "dim") return "muted";
	if (color === "muted") return "text";
	return color;
}
