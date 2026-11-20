/**
 * Content pane (right, full height, read-only).
 *
 * Renders `ContentBlock[]` as boxed messages ("YOU · 22:18" / "ASSISTANT · 22:18")
 * using pi's native Markdown renderer from @earendil-works/pi-tui.
 *
 * The pane is a line-scrolled viewport: `layoutContent` turns the blocks into
 * body lines once (the panel caches it), and `renderContentPane` shows the
 * window starting at `scroll`. One block can be highlighted (the node selected
 * in the tree pane): its header gets a `›` marker and the selected background.
 * A `/` search matches the rendered text lines (`ContentLayout.searchable`
 * marks them; box borders and headers are skipped); the hits on the visible
 * lines are painted over the cached lines at render time, nothing is re-rendered.
 */

import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { t } from "../../i18n/index.ts";
import type { ContentBlock, SearchView } from "../../types.ts";
import { formatTime } from "../../utils/format.ts";
import { clamp } from "../../utils/indices.ts";
import { fit, frame, metaBudget } from "../frame.ts";
import { highlightLine, matchStyle, searchMeta } from "../search-highlight.ts";

/** Body lines of the whole conversation plus where each block starts. */
export interface ContentLayout {
	lines: string[];
	/** entryId → index of the block's header line in `lines`. */
	starts: Map<string, number>;
	/** Per line: true for rendered message text (what `/` searches), false for box borders, headers and gaps. */
	searchable: boolean[];
}

export interface ContentPaneProps {
	blocks: ContentBlock[];
	/** Precomputed layout (see `layoutContent`); computed on the fly when omitted. */
	layout?: ContentLayout;
	/** First body line shown; clamped to the last full page. */
	scroll: number;
	/** entryId of the block to highlight (the tree cursor), if any. */
	highlightEntryId?: string;
	/** Active `/` search of this pane (indices into the layout lines): hits on the visible lines are painted, the header shows the count. */
	search?: SearchView;
	focused: boolean;
	title?: string;
	emptyMessage?: string;
	theme: Theme;
}

/** Layout all blocks into body lines of exactly `inner` width. */
export function layoutContent(blocks: ContentBlock[], inner: number, theme: Theme, highlightEntryId?: string): ContentLayout {
	const lines: string[] = [];
	const searchable: boolean[] = [];
	const starts = new Map<string, number>();
	const mdTheme = getMarkdownTheme();
	// One column of margin on each side of every message box.
	const boxW = Math.max(10, inner - 2);
	const textW = boxW - 4; // "│ " + " │"
	const push = (line: string, text: boolean) => {
		lines.push(line);
		searchable.push(text);
	};

	for (const block of blocks) {
		const isUser = block.role === "user";
		const isHighlight = block.entryId === highlightEntryId;
		const who = isUser ? t("pane.you") : t("pane.assistant");
		const head = ` ${who} · ${formatTime(block.timestamp)} `;
		const borderStyle = (s: string) => theme.fg(isUser ? "userMessageText" : "accent", s);
		const headStyle = (s: string) => theme.bold(theme.fg(isUser ? "userMessageText" : "accent", s));

		// 被 tree 选中的消息：左边距变成 › 箭头，头部整行加选中背景，方便一眼定位。
		// fill 必须按可见宽度算：中文标签（你 / AI助手）是全角字符，用 head.length 会算漏，
		// 导致 ┐ 被推到右边、和下边框对不齐，甚至溢出面板被截成 …。
		const fill = Math.max(0, boxW - 3 - visibleWidth(head));
		const headerRaw = borderStyle("┌─") + headStyle(head) + borderStyle("─".repeat(fill) + "┐");
		starts.set(block.entryId, lines.length);
		push(isHighlight ? theme.bg("selectedBg", fit(theme.bold(theme.fg("accent", "›")) + headerRaw, inner)) : " " + headerRaw, false);

		const md = new Markdown(block.markdown, 0, 0, mdTheme);
		let rendered: string[];
		try {
			rendered = md.render(textW);
		} catch {
			rendered = block.markdown.split("\n");
		}
		if (rendered.length === 0) rendered = [""];
		for (const raw of rendered) {
			push(" " + borderStyle("│") + " " + fit(raw, textW) + " " + borderStyle("│"), true);
		}
		push(" " + borderStyle(`└${"─".repeat(boxW - 2)}┘`), false);
		push("", false);
	}
	return { lines, starts, searchable };
}

/** Largest valid scroll offset for `total` lines in a viewport of `visible` lines. */
export function maxScroll(total: number, visible: number): number {
	return Math.max(0, total - visible);
}

/**
 * How far the viewport sits through the conversation, for the title meta:
 * 0 at the top, 100 at the bottom, undefined when everything fits (nothing to
 * scroll, so there is no position to report). 圆整后的中间值夹在 1–99：
 * 只有真的到顶 / 到底才显示 0% / 100%，四舍五入不会骗人（`zz` 越界滚到末尾
 * 之外的值也夹成 100%）。
 */
export function scrollPercent(scroll: number, total: number, visible: number): number | undefined {
	const max = maxScroll(total, visible);
	if (max <= 0) return undefined;
	const at = clamp(scroll, 0, max);
	if (at === 0) return 0;
	if (at === max) return 100;
	return clamp(Math.round((at / max) * 100), 1, 99);
}

/**
 * Right-aligned title meta of the CONTENT pane: the `/` search count while a
 * search is active, otherwise the message count, followed by the scroll
 * percentage ("12 messages · 34%"). 宽度不够时先丢百分比；百分比本身也放不下
 * 时只留它——"在哪"比"有多少"更值得知道，和 sessionsMeta / treeMeta 保留位置、
 * 先丢描述性字段的降级顺序一致。搜索计数自己也会按剩余空间降级
 * （"2/7 matches" → "2/7"）。
 */
export function contentMeta(blocks: number, search: SearchView | undefined, percent: number | undefined, budget: number): string {
	const suffix = percent === undefined ? "" : `${percent}%`;
	if (search) {
		if (suffix) {
			// 先给百分比留出位置，搜索计数在剩下的空间里选长 / 短写法；两样一起放不下就只留搜索计数。
			const base = searchMeta(search.position, search.total, Math.max(0, budget - visibleWidth(suffix) - 3));
			const full = `${base} · ${suffix}`;
			if (visibleWidth(full) <= budget) return full;
		}
		return searchMeta(search.position, search.total, budget);
	}
	if (blocks === 0) return "";
	const base = t("pane.messages", { count: blocks });
	if (!suffix) return base;
	const full = `${base} · ${suffix}`;
	return visibleWidth(full) <= budget ? full : suffix;
}

export function renderContentPane(p: ContentPaneProps, width: number, height: number): string[] {
	const { theme } = p;
	const inner = width - 2;
	const visible = Math.max(1, height - 2);
	let body: string[];
	// 标题右侧的滚动百分比：没有内容、或一屏装得下时为 undefined（不显示）。
	let percent: number | undefined;
	if (p.blocks.length === 0) {
		body = [theme.fg("muted", ` ${p.emptyMessage ?? t("pane.contentEmpty")}`)];
	} else {
		const all = (p.layout ?? layoutContent(p.blocks, inner, theme, p.highlightEntryId)).lines;
		// 允许滚过最后一整页（`zz` 居中最后几条消息时会这样，下方由 frame 补空行）；
		// 常规滚动的 scroll 由调用方夹在 maxScroll 内，这里只兜底不让整段滚出视野。
		const start = Math.min(Math.max(0, p.scroll), Math.max(0, all.length - 1));
		body = all.slice(start, start + visible);
		// 和画出来的窗口用同一个 start 算，标题上的数字和画面不会对不上。
		percent = scrollPercent(start, all.length, visible);
		// 搜索命中：只给窗口里的命中行叠加高亮，缓存的排版结果本身不动。
		const search = p.search;
		if (search && search.total > 0) {
			body = body.map((line, k) => {
				const index = start + k;
				return search.matches.has(index) ? highlightLine(line, search.terms, matchStyle(theme, index === search.current)) : line;
			});
		}
	}
	const title = p.title ?? "CONTENT";
	const meta = contentMeta(p.blocks.length, p.search, percent, metaBudget(width, title));
	return frame(body, {
		width,
		height,
		title,
		meta,
		border: (s) => theme.fg(p.focused ? "borderAccent" : "border", s),
		titleStyle: (s) => (p.focused ? theme.bold(theme.fg("accent", s)) : theme.fg("muted", s)),
		metaStyle: (s) => theme.fg("dim", s),
	});
}
