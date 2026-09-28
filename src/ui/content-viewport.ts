/**
 * The CONTENT pane's view of the loaded branch: its blocks, the layout cache
 * (per width and highlight), scrolling — including `zz`, which may scroll past
 * the last full page so a message near the end can sit in the middle — the
 * highlighted message and the `/` matches among the rendered lines.
 *
 * The scroll position and the highlight stay in `PanelState`
 * (`cursor.content` / `contentHighlight`), so all panel state remains in one
 * place; this class keeps the rest and the rules for moving them. Deciding
 * *which* message to highlight (following the tree cursor) is the panel's job.
 *
 * CONTENT 面板的视口：消息块、排版缓存、滚动（含 zz 越界居中）、高亮、正文搜索缓存。
 * 滚动位置和高亮仍然放在 PanelState 里；高亮哪条消息（跟着 TREE 光标）由面板决定。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { matchesTokens, parseSearchQuery, searchTokens } from "../data/search.ts";
import type { ContentBlock } from "../types.ts";
import { clamp, indicesWhere } from "../utils/indices.ts";
import { type ContentLayout, layoutContent, maxScroll } from "./panes/content-pane.ts";
import type { PanelState } from "./state.ts";

export interface ContentViewportOptions {
	theme: Theme;
	/** Panel state: the viewport reads and writes `cursor.content` (first visible body line) and `contentHighlight`. */
	state: PanelState;
	/** The scroll position or the highlight changed; the panel re-renders. */
	onChange: () => void;
}

export class ContentViewport {
	private _blocks: ContentBlock[] = [];
	/** Leaf entry the current branch ends at (undefined = the session's own leaf). */
	private _leaf: string | undefined;
	/** Layout cache keyed by blocks identity / width / highlight. */
	private cache: { blocks: ContentBlock[]; inner: number; highlight: string | undefined; layout: ContentLayout } | undefined;
	/** Viewport size as of the last render, used to clamp scrolling. */
	private view = { inner: 60, visible: 10 };
	/**
	 * True right after `zz` centered the highlighted message: the pane may then
	 * scroll past the last full page (padding blanks below) so an end-of-file
	 * message can sit in the middle, like vim's `zz`. Any normal scroll clears
	 * it and the view snaps back to the last-full-page clamp.
	 */
	private centered = false;
	/** Matching body lines per layout and query (the layout changes with the width, so the matches follow it). */
	private searchCache: { layout: ContentLayout; query: string; matches: number[] } | undefined;

	constructor(private readonly o: ContentViewportOptions) {}

	/** Blocks of the branch on show. */
	get blocks(): ContentBlock[] {
		return this._blocks;
	}

	/** Leaf entry the blocks end at (undefined = the session's own leaf, i.e. the active branch). */
	get leaf(): string | undefined {
		return this._leaf;
	}

	/** Show another branch (or nothing); the scroll position and the highlight are the caller's to set. */
	setBlocks(blocks: ContentBlock[], leaf: string | undefined): void {
		this._blocks = blocks;
		this._leaf = leaf;
		this.cache = undefined;
	}

	/** Cached layout of the blocks for the last rendered width. */
	layout(): ContentLayout {
		const { inner } = this.view;
		const highlight = this.o.state.contentHighlight;
		const c = this.cache;
		if (c && c.blocks === this._blocks && c.inner === inner && c.highlight === highlight) return c.layout;
		const layout = layoutContent(this._blocks, inner, this.o.theme, highlight);
		this.cache = { blocks: this._blocks, inner, highlight, layout };
		return layout;
	}

	/** Remember the viewport for this render (so keys can clamp against it) and return the layout. */
	layoutFor(inner: number, visible: number): ContentLayout {
		this.view = { inner: Math.max(1, inner), visible: Math.max(1, visible) };
		const layout = this.layout();
		// 窗口变小后原来的滚动位置可能越界，这里顺手夹回来；`zz` 居中时允许滚过末尾（夹到末行）。
		const max = this.centered ? Math.max(0, layout.lines.length - 1) : maxScroll(layout.lines.length, this.view.visible);
		this.o.state.cursor.content = clamp(this.o.state.cursor.content, 0, max);
		return layout;
	}

	/** Scroll so body line `line` is at the top, clamped to the last full page. */
	scrollTo(line: number): void {
		// 普通滚动：回到常规夹取范围（清掉 zz 的越界居中标记），越界值会被夹回最后一整页。
		this.centered = false;
		const next = clamp(line, 0, this.maxScroll());
		if (next === this.o.state.cursor.content) return;
		this.o.state.cursor.content = next;
		this.o.onChange();
	}

	scrollBy(delta: number): void {
		this.scrollTo(this.o.state.cursor.content + delta);
	}

	/** J / K from the sessions pane scroll by half a viewport. */
	pageStep(): number {
		return Math.max(1, Math.floor(this.view.visible / 2));
	}

	/**
	 * Highlight `entryId` (or nothing) and scroll its first line to the top —
	 * a normal scroll, so a `zz` overscroll ends.
	 */
	highlight(entryId: string | undefined): void {
		this.o.state.contentHighlight = entryId;
		if (entryId) {
			const start = this.layout().starts.get(entryId) ?? 0;
			// 高亮切换是普通滚动（把消息滚到顶部）：清掉 zz 的越界居中标记。
			this.centered = false;
			this.o.state.cursor.content = Math.min(start, this.maxScroll());
		}
		this.o.onChange();
	}

	/**
	 * zz: scroll so the highlighted message sits in the middle of the viewport
	 * (vim's zz), past the last full page if that is what it takes. Returns
	 * false when no message is highlighted (nothing to center on).
	 */
	center(): boolean {
		const target = this.o.state.contentHighlight;
		if (!target || this._blocks.length === 0) return false;
		const layout = this.layout();
		const start = layout.starts.get(target);
		if (start === undefined) return true;
		// 让选中消息的头部行落在窗口正中：起始行减去半个可见窗口，允许滚过末尾以居中末尾消息。
		const half = Math.floor((this.view.visible - 1) / 2);
		this.centered = true;
		this.o.state.cursor.content = clamp(start - half, 0, Math.max(0, layout.lines.length - 1));
		this.o.onChange();
		return true;
	}

	/**
	 * Body lines of the current layout matching `query` (free text only: every
	 * token on the line, qualifiers mean nothing here). Cached per layout, so a
	 * resize (which re-wraps the lines) recomputes them.
	 */
	matches(query: string): number[] {
		const layout = this.layout();
		const c = this.searchCache;
		if (c && c.layout === layout && c.query === query) return c.matches;
		const tokens = searchTokens(parseSearchQuery(query));
		const matches = tokens.length
			? indicesWhere(layout.lines, (line, i) => layout.searchable[i] === true && matchesTokens(stripTerminalSequences(line), tokens))
			: [];
		this.searchCache = { layout, query, matches };
		return matches;
	}

	private maxScroll(): number {
		return maxScroll(this.layout().lines.length, this.view.visible);
	}
}
