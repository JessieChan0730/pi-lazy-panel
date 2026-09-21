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
 */

import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import type { ContentBlock } from "../../types.ts";
import { formatTime } from "../../utils/format.ts";
import { fit, frame } from "../frame.ts";

/** Body lines of the whole conversation plus where each block starts. */
export interface ContentLayout {
	lines: string[];
	/** entryId → index of the block's header line in `lines`. */
	starts: Map<string, number>;
}

export interface ContentPaneProps {
	blocks: ContentBlock[];
	/** Precomputed layout (see `layoutContent`); computed on the fly when omitted. */
	layout?: ContentLayout;
	/** First body line shown; clamped to the last full page. */
	scroll: number;
	/** entryId of the block to highlight (the tree cursor), if any. */
	highlightEntryId?: string;
	focused: boolean;
	title?: string;
	emptyMessage?: string;
	theme: Theme;
}

/** Layout all blocks into body lines of exactly `inner` width. */
export function layoutContent(blocks: ContentBlock[], inner: number, theme: Theme, highlightEntryId?: string): ContentLayout {
	const lines: string[] = [];
	const starts = new Map<string, number>();
	const mdTheme = getMarkdownTheme();
	// One column of margin on each side of every message box.
	const boxW = Math.max(10, inner - 2);
	const textW = boxW - 4; // "│ " + " │"

	for (const block of blocks) {
		const isUser = block.role === "user";
		const isHighlight = block.entryId === highlightEntryId;
		const who = isUser ? "YOU" : "ASSISTANT";
		const head = ` ${who} · ${formatTime(block.timestamp)} `;
		const borderStyle = (s: string) => theme.fg(isUser ? "userMessageText" : "accent", s);
		const headStyle = (s: string) => theme.bold(theme.fg(isUser ? "userMessageText" : "accent", s));

		// 被 tree 选中的消息：左边距变成 › 箭头，头部整行加选中背景，方便一眼定位。
		const fill = Math.max(0, boxW - 3 - head.length);
		const headerRaw = borderStyle("┌─") + headStyle(head) + borderStyle("─".repeat(fill) + "┐");
		starts.set(block.entryId, lines.length);
		lines.push(isHighlight ? theme.bg("selectedBg", fit(theme.bold(theme.fg("accent", "›")) + headerRaw, inner)) : " " + headerRaw);

		const md = new Markdown(block.markdown, 0, 0, mdTheme);
		let rendered: string[];
		try {
			rendered = md.render(textW);
		} catch {
			rendered = block.markdown.split("\n");
		}
		if (rendered.length === 0) rendered = [""];
		for (const raw of rendered) {
			lines.push(" " + borderStyle("│") + " " + fit(raw, textW) + " " + borderStyle("│"));
		}
		lines.push(" " + borderStyle(`└${"─".repeat(boxW - 2)}┘`));
		lines.push("");
	}
	return { lines, starts };
}

/** Largest valid scroll offset for `total` lines in a viewport of `visible` lines. */
export function maxScroll(total: number, visible: number): number {
	return Math.max(0, total - visible);
}

export function renderContentPane(p: ContentPaneProps, width: number, height: number): string[] {
	const { theme } = p;
	const inner = width - 2;
	const visible = Math.max(1, height - 2);
	let body: string[];
	if (p.blocks.length === 0) {
		body = ["", theme.fg("muted", `  ${p.emptyMessage ?? "No messages."}`)];
	} else {
		const all = (p.layout ?? layoutContent(p.blocks, inner, theme, p.highlightEntryId)).lines;
		const start = Math.min(Math.max(0, p.scroll), maxScroll(all.length, visible));
		body = all.slice(start, start + visible);
	}
	const meta = p.blocks.length ? `${p.blocks.length} messages` : "";
	return frame(body, {
		width,
		height,
		title: p.title ?? "CONTENT",
		meta,
		border: (s) => theme.fg(p.focused ? "borderAccent" : "border", s),
		titleStyle: (s) => (p.focused ? theme.bold(theme.fg("accent", s)) : theme.fg("muted", s)),
		metaStyle: (s) => theme.fg("dim", s),
	});
}
