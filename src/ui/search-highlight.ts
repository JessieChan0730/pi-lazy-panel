/**
 * Search-match highlighting shared by the three panes (pure functions).
 *
 * A pane renders its row / line exactly as before — colours, cursor background,
 * truncation — and then paints the matches on top by visible column, the way
 * pi's own transcript search does: the line is cut into before / match / after
 * with pi-tui's ANSI-aware `sliceByColumn`, only the plain text runs of the
 * match get the match style, and the "after" slice starts with the styles that
 * were active there, so a colour or cursor background the match interrupted
 * carries on afterwards. Matches use the theme's search colours; the current
 * match (the one the cursor is on) is additionally bold + inverse so it stands
 * out from the other matches, like in lazygit / pi.
 *
 * 高亮不改变面板原来的画法：先按原样画好整行，再按可见列把命中的片段切出来加样式
 * （pi 自己的全屏搜索就是这么做的），所以命中前后的颜色和光标行的背景都不会断掉。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { findMatchRanges } from "../data/search.ts";

/** How one rendered row is highlighted: the terms to mark, and whether it is the current match. */
export interface RowHighlight {
	terms: string[];
	current: boolean;
}

/** SGR / CSI / OSC sequences, so the styling can skip them and wrap only the text between. */
const ANSI_RE = /\x1b\[[0-9;?:<=>]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * Style of a match: the theme's search colours, underlined for the other
 * matches, bold + inverse for the current one (pi's own choice; the inverse
 * shows even on a theme whose search background equals the cursor background).
 */
export function matchStyle(theme: Theme, current: boolean): (text: string) => string {
	const colours = (s: string) => theme.bg("searchMatchBg", theme.fg("searchMatchText", s));
	return current ? (s) => theme.bold(theme.inverse(colours(s))) : (s) => theme.underline(colours(s));
}

/**
 * Paint every occurrence of `terms` in the already-rendered `line` with
 * `style`, keeping its visible width and the styles around the matches.
 */
export function highlightLine(line: string, terms: string[], style: (text: string) => string): string {
	const plain = stripTerminalSequences(line);
	const ranges = findMatchRanges(plain, terms);
	if (ranges.length === 0) return line;
	const width = visibleWidth(plain);
	let out = line;
	// 从右往左处理，前面片段的列号不受已经改过的部分影响。
	for (let i = ranges.length - 1; i >= 0; i--) {
		const r = ranges[i]!;
		const startCol = visibleWidth(plain.slice(0, r.start));
		const endCol = Math.min(width, startCol + visibleWidth(plain.slice(r.start, r.end)));
		if (endCol <= startCol) continue;
		// sliceByColumn 会丢掉最后一个可见字符之后的转义序列（光标行末尾的背景色复位、上一轮画在行尾的高亮结束码），
		// 每一轮都先剥下来、切完再接回去。
		const [body, tail] = splitTail(out);
		const before = sliceByColumn(body, 0, startCol, true);
		const match = sliceByColumn(body, startCol, endCol - startCol, true);
		const after = sliceByColumn(body, endCol, Math.max(0, width - endCol), true);
		out = `${before}${styleText(match, style)}${after}${tail}`;
	}
	return out;
}

/** Split off the escape sequences after the last visible character of `line`. */
function splitTail(line: string): [body: string, tail: string] {
	let end = line.length;
	for (;;) {
		const m = TRAILING_ANSI_RE.exec(line.slice(0, end));
		if (!m) break;
		end -= m[0].length;
	}
	return [line.slice(0, end), line.slice(end)];
}

/** One escape sequence at the very end of a string. */
const TRAILING_ANSI_RE = /(?:\x1b\[[0-9;?:<=>]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))$/;

/** Apply `style` to the plain text runs of `text`, leaving its escape sequences in place. */
function styleText(text: string, style: (text: string) => string): string {
	let out = "";
	let last = 0;
	for (const m of text.matchAll(ANSI_RE)) {
		if (m.index > last) out += style(text.slice(last, m.index));
		out += m[0];
		last = m.index + m[0].length;
	}
	if (last < text.length) out += style(text.slice(last));
	return out;
}

/**
 * Header meta while a search is active: "2/7 matches", "7 matches" when the
 * cursor is not on a match, "no matches" for none; shortened to fit `budget`.
 */
export function searchMeta(position: number, total: number, budget: number): string {
	const candidates =
		total === 0 ? ["no matches", "0/0"] : position > 0 ? [`${position}/${total} matches`, `${position}/${total}`] : [`${total} matches`, `${total}`];
	return candidates.find((c) => visibleWidth(c) <= budget) ?? candidates[candidates.length - 1]!;
}
