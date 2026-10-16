/**
 * Pure box-drawing helpers shared by the panes. No I/O, no pi APIs.
 *
 * Every returned line has a visible width of exactly `width`, which is what
 * pi-tui requires from `Component.render()`.
 */

import { compositeTuiLine, sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type Style = (s: string) => string;

// 清除 SGR 样式并闭合 OSC8 超链接，和 pi-tui 内部的 SEGMENT_RESET 一致，避免补的空格继承上一段颜色。
const SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

/**
 * 把恰好横跨 `boundary` 这一列的宽字符（如中文、Emoji）替换成等宽空格。
 *
 * pi-tui 的 compositeTuiLine 在叠加弹窗时，会按列把底图切成「弹窗左侧 / 弹窗 / 弹窗右侧」。
 * 如果某个宽字符一半在弹窗内、一半在弹窗外，它既进不了左段也进不了右段，会被整个丢掉，
 * compositeTuiLine 再把少掉的那一列用空格补在整行末尾——于是弹窗右侧的内容（含右边框）整体向左错一列。
 * 英文都是单列字符，边界永远落在字符间隙，所以只有中文等宽字符才会触发。
 *
 * 这里提前把跨边界的宽字符换成同宽空格：边界落到字符间隙上，compositeTuiLine 不再丢字，右侧也就不再错位。
 * 边界本就落在间隙、或底图在该列之前就结束时，原样返回。
 */
function clearStraddleAt(line: string, boundary: number): string {
	if (boundary <= 0) return line;
	const lineW = visibleWidth(line);
	if (lineW <= boundary) return line; // 边界在内容末尾之后，不存在跨界字符
	// 严格截取 [0, boundary)：跨界的宽字符会被整体排除，head 宽度退到 boundary - 1（或更小）。
	const head = sliceByColumn(line, 0, boundary, true);
	const headW = visibleWidth(head);
	if (headW === boundary) return line; // 边界正好落在字符间隙，无需处理
	// 截取 [boundary, 末尾)：跨界字符（起点 < boundary）同样被排除，tail 从它之后开始。
	const tail = sliceByColumn(line, boundary, lineW - boundary);
	const tailStartCol = lineW - visibleWidth(tail); // tail 在原行里的真实起始列
	const gap = Math.max(0, tailStartCol - headW); // 被丢弃的宽字符所占的列数，用等宽空格补齐
	return head + SEGMENT_RESET + " ".repeat(gap) + tail;
}

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
	// 标题为空时不画 " title " 段，顶边连成整条横线（避免 "┌─  ──┐" 中间的缺口）；meta 仍正常显示。
	const title = o.title ? ` ${o.title} ` : "";
	const meta = o.meta ? ` ${o.meta} ` : "";
	const titleW = visibleWidth(title);
	const metaW = visibleWidth(meta);
	// "┌─ TITLE ───── meta ─┐"
	const fill = inner - 1 - titleW - metaW - (meta ? 1 : 0);
	if (fill < 0) {
		// Not enough room: drop meta, then clip title.
		const t = truncateToWidth(title, Math.max(0, inner - 2), "…", false);
		return o.border(`┌─`) + (t ? o.titleStyle(t) : "") + o.border("─".repeat(Math.max(0, inner - 1 - visibleWidth(t))) + "┐");
	}
	const styledTitle = title ? o.titleStyle(title) : "";
	const metaPart = meta ? (o.metaStyle ?? o.titleStyle)(meta) + o.border("─") : "";
	return o.border("┌─") + styledTitle + o.border("─".repeat(fill)) + metaPart + o.border("┐");
}

/**
 * Where a centered dialog box sits in the viewport it is composited into, in
 * cell coordinates (0-based, relative to the top-left of the panel body).
 */
export interface BoxRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

/**
 * Where a `width` × `height` box lands in a `termW` × `termH` viewport.
 *
 * 画和命中共用这一份几何：`overlayCentered` 用它算位置，弹窗鼠标命中也用它（`boxCell`），
 * 所以改版式不会让点击和画面错位（和 `ui/mouse.ts` 的 panelGeometry 是同一条纪律）。
 * `width` / `height` 原样保留 —— 调用方已经按终端夹取过，这里再做"帮忙"的夹取只会让两张图分叉。
 *
 * `termH` is how many lines the overlay is composited into: the panel BODY, one row
 * shorter than the terminal (the footer is appended after the overlays), never
 * `event.height` — getting that wrong shifts every box down by one row.
 */
export function centeredRect(termW: number, termH: number, width: number, height: number, fixedTop?: number): BoxRect {
	return {
		top: Math.max(0, Math.floor(fixedTop ?? (termH - height) / 2)),
		left: Math.max(0, Math.floor((termW - width) / 2)),
		width,
		height,
	};
}

/** Is the cell (x, y) anywhere on the box, border included? (Wheel is forgiving about the frame; clicks use `boxCell`.) */
export function boxContains(r: BoxRect, x: number, y: number): boolean {
	return x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;
}

/**
 * The cell's row / column inside a box's body (0 = the line under the top border,
 * 0 = the column after the left border), or undefined on the border and outside
 * the box. Clicks there do nothing — a stray click never closes a dialog.
 */
export function boxCell(r: BoxRect, x: number, y: number): { row: number; col: number } | undefined {
	if (!boxContains(r, x, y)) return undefined;
	const row = y - r.top - 1;
	const col = x - r.left - 1;
	if (row < 0 || row >= r.height - 2 || col < 0 || col >= r.width - 2) return undefined;
	return { row, col };
}

/**
 * Composite `box` (lines of exactly `width` columns) centered over the
 * already-rendered `base` lines of a `termW`-column terminal. Shared by the
 * help overlay and the dialogs; box rows beyond `base` are dropped.
 *
 * Pass `backdrop` for a modal: restyle the base and clear a one-cell gutter
 * outside the box, clipped to the available space without moving the box.
 *
 * Pass `fixedTop` to reveal a pre-laid-out box without re-centering each animation frame.
 *
 * 弹窗只弱化底图：先清掉选中背景、反色和隐藏层的输入光标，再套主题色。
 * 上层原样叠加，嵌套时不会越叠越暗，关闭后也不影响原来的面板状态。
 */
export function overlayCentered(base: string[], box: string[], width: number, termW: number, backdrop?: Style, fixedTop?: number): string[] {
	// 位置走 centeredRect：弹窗的鼠标命中用同一个函数，画到哪就点到哪。
	const { top, left } = centeredRect(termW, base.length, width, box.length, fixedTop);
	const out = backdrop ? base.map((line) => backdrop(stripTerminalSequences(line))) : [...base];
	if (backdrop && box.length && width > 0 && termW > 0) {
		const gutterLeft = Math.max(0, left - 1);
		const gutterWidth = Math.min(termW, left + width + 1) - gutterLeft;
		const blank = " ".repeat(gutterWidth);
		for (let i = Math.max(0, top - 1); i < Math.min(out.length, top + box.length + 1); i++) {
			// 先清掉跨越边框右边界的宽字符，否则 compositeTuiLine 丢字会让右侧内容错位。
			const base = clearStraddleAt(out[i] ?? "", gutterLeft + gutterWidth);
			out[i] = compositeTuiLine(base, blank, gutterLeft, gutterWidth, termW);
		}
	}
	for (let i = 0; i < box.length && top + i < out.length; i++) {
		// 同理：弹窗右边界跨界的宽字符先换成空格，再叠加弹窗。
		const base = clearStraddleAt(out[top + i] ?? "", left + width);
		// 宽字符恰好跨过终端右边界时，pi-tui 会整字裁掉，再补齐留下的那一列。
		out[top + i] = fit(compositeTuiLine(base, box[i]!, left, width, termW), termW);
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
