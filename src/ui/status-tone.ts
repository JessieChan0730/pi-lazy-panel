/**
 * Footer status tones: what a status line is telling the user decides its
 * colour, so "copied" / "exported to …" no longer look like a failure.
 *
 *   success — an operation finished (copied, exported, deleted, renamed…)  -> theme `success` (green)
 *   info    — hints and progress (loading…, nothing selected, unavailable)  -> theme `warning` (the old colour)
 *   error   — something failed                                              -> theme `error` (red)
 *
 * footer 的状态文字按语气配色：完成类用 success（绿），提示 / 进度沿用原来的 warning，
 * 失败用 error（红）。footer 和搜索状态行共用这一张表，保证同一条消息在两处颜色一致。
 */

import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { StatusTone } from "../types.ts";

const STATUS_COLORS: Record<StatusTone, ThemeColor> = {
	success: "success",
	info: "warning",
	error: "error",
};

/** Theme colour of a status line; an omitted tone is a plain hint (`info`). */
export function statusColor(tone: StatusTone | undefined): ThemeColor {
	return STATUS_COLORS[tone ?? "info"];
}
