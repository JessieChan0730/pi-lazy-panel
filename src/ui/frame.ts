/**
 * Pure box-drawing helpers shared by the panes. No I/O, no pi APIs.
 *
 * Every returned line has a visible width of exactly `width`, which is what
 * pi-tui requires from `Component.render()`.
 */

import { compositeTuiLine, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type Style = (s: string) => string;

export interface FrameOptions {
	width: number;
	height: number;
	title: string;
	/** Applied to border characters. */
	border: Style;
	/** Applied to the title text. */
	titleStyle: Style;
	/** Optional right-aligned text on the top border (e.g. "1/12"). */
	meta?: string;
	metaStyle?: Style;
}

/** Pad or truncate `line` to exactly `width` visible columns. */
export function fit(line: string, width: number): string {
	if (width <= 0) return "";
	const w = visibleWidth(line);
	if (w === width) return line;
	if (w < width) return line + " ".repeat(width - w);
	return truncateToWidth(line, width, "…", true);
}

/**
 * Max visible columns of `meta` text that `frame()` can show next to `title`
 * without dropping it. Panes use this to pick a shorter meta variant instead of
 * silently losing the whole "1/15 · Current · recent" hint in a narrow column.
 *
 * 推导：顶边 = "┌─" + " title " + fill + " meta " + "─" + "┐"，fill >= 0 时 meta 才保留，
 * 即 meta 文本宽度 <= width - 8 - visibleWidth(title)。
 */
export function metaBudget(width: number, title: string): number {
	return Math.max(0, width - 8 - visibleWidth(title));
}

/**
 * Body line that `frame()` draws as a horizontal divider (`├────┤`) instead of
 * a `│ … │` row. Used by dialogs with a header / list / hints layout.
 */
export const FRAME_DIVIDER = "\u0000divider";

/** Build a bordered frame around `body`. Body lines are clipped/padded to the inner size. */
export function frame(body: string[], o: FrameOptions): string[] {
	const { width, height } = o;
	if (width < 4 || height < 2) return Array.from({ length: Math.max(0, height) }, () => fit("", width));
	const inner = width - 2;
	const top = topBorder(o, inner);
	const bottom = o.border(`└${"─".repeat(inner)}┘`);
	const rows = height - 2;
	const lines: string[] = [top];
	for (let i = 0; i < rows; i++) {
		const line = body[i] ?? "";
		if (line === FRAME_DIVIDER) lines.push(o.border(`├${"─".repeat(inner)}┤`));
		else lines.push(o.border("│") + fit(line, inner) + o.border("│"));
	}
	lines.push(bottom);
	return lines;
}

function topBorder(o: FrameOptions, inner: number): string {
	const title = ` ${o.title} `;
	const meta = o.meta ? ` ${o.meta} ` : "";
	const titleW = visibleWidth(title);
	const metaW = visibleWidth(meta);
	// "┌─ TITLE ───── meta ─┐"
	const fill = inner - 1 - titleW - metaW - (meta ? 1 : 0);
	if (fill < 0) {
		// Not enough room: drop meta, then clip title.
		const t = truncateToWidth(title, Math.max(0, inner - 2), "…", false);
		return o.border(`┌─`) + o.titleStyle(t) + o.border("─".repeat(Math.max(0, inner - 1 - visibleWidth(t))) + "┐");
	}
	const metaPart = meta ? (o.metaStyle ?? o.titleStyle)(meta) + o.border("─") : "";
	return o.border("┌─") + o.titleStyle(title) + o.border("─".repeat(fill)) + metaPart + o.border("┐");
}

/**
 * Composite `box` (lines of exactly `width` columns) centered over the
 * already-rendered `base` lines of a `termW`-column terminal. Shared by the
 * help overlay and the dialogs; box rows beyond `base` are dropped.
 *
 * Pass `backdrop` for a modal: restyle the base and clear a one-cell gutter
 * outside the box, clipped to the available space without moving the box.
 *
 * 弹窗只弱化底图：先清掉选中背景、反色和隐藏层的输入光标，再套主题色。
 * 上层原样叠加，嵌套时不会越叠越暗，关闭后也不影响原来的面板状态。
 */
export function overlayCentered(base: string[], box: string[], width: number, termW: number, backdrop?: Style): string[] {
	const top = Math.max(0, Math.floor((base.length - box.length) / 2));
	const left = Math.max(0, Math.floor((termW - width) / 2));
	const out = backdrop ? base.map((line) => backdrop(stripTerminalSequences(line))) : [...base];
	if (backdrop && box.length && width > 0 && termW > 0) {
		const gutterLeft = Math.max(0, left - 1);
		const gutterWidth = Math.min(termW, left + width + 1) - gutterLeft;
		const blank = " ".repeat(gutterWidth);
		for (let i = Math.max(0, top - 1); i < Math.min(out.length, top + box.length + 1); i++) {
			out[i] = compositeTuiLine(out[i] ?? "", blank, gutterLeft, gutterWidth, termW);
		}
	}
	for (let i = 0; i < box.length && top + i < out.length; i++) {
		// 宽字符恰好跨过终端右边界时，pi-tui 会整字裁掉，再补齐留下的那一列。
		out[top + i] = fit(compositeTuiLine(out[top + i] ?? "", box[i]!, left, width, termW), termW);
	}
	return out;
}

/** Width of a centered dialog box (input prompt, menu) for a `termW`-column terminal. */
export function dialogWidth(termW: number): number {
	return Math.max(24, Math.min(termW - 4, 60));
}

/** Place `left` and `right` column line arrays side by side. Both must already be the right width. */
export function sideBySide(left: string[], right: string[], leftWidth: number, rightWidth: number): string[] {
	const n = Math.max(left.length, right.length);
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		out.push(fit(left[i] ?? "", leftWidth) + fit(right[i] ?? "", rightWidth));
	}
	return out;
}
