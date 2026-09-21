/**
 * Content pane (right, full height, read-only).
 *
 * Renders `ContentBlock[]` as boxed messages ("YOU · 22:18" / "ASSISTANT · 22:18")
 * using pi's native Markdown renderer from @earendil-works/pi-tui.
 *
 * Static for now: shows the top of the conversation (scroll offset 0). Cursor,
 * scrolling, yank, preview and search come in a later task.
 */

import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import type { ContentBlock } from "../../types.ts";
import { formatTime } from "../../utils/format.ts";
import { fit, frame } from "../frame.ts";

export interface ContentPaneProps {
	blocks: ContentBlock[];
	/** First body line shown (scrolling is a later task; keep 0 for now). */
	scroll: number;
	focused: boolean;
	title?: string;
	emptyMessage?: string;
	theme: Theme;
}

/** Layout all blocks into body lines of exactly `inner` width. */
export function layoutBlocks(blocks: ContentBlock[], inner: number, theme: Theme): string[] {
	const lines: string[] = [];
	const mdTheme = getMarkdownTheme();
	// One column of margin on each side of every message box.
	const boxW = Math.max(10, inner - 2);
	const textW = boxW - 4; // "│ " + " │"

	for (const block of blocks) {
		const isUser = block.role === "user";
		const who = isUser ? "YOU" : "ASSISTANT";
		const head = ` ${who} · ${formatTime(block.timestamp)} `;
		const borderStyle = (s: string) => theme.fg(isUser ? "userMessageText" : "accent", s);
		const headStyle = (s: string) => theme.bold(theme.fg(isUser ? "userMessageText" : "accent", s));

		const fill = Math.max(0, boxW - 3 - head.length);
		lines.push(" " + borderStyle("┌─") + headStyle(head) + borderStyle("─".repeat(fill) + "┐"));

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
	return lines;
}

export function renderContentPane(p: ContentPaneProps, width: number, height: number): string[] {
	const { theme } = p;
	const inner = width - 2;
	const visible = Math.max(1, height - 2);
	let body: string[];
	if (p.blocks.length === 0) {
		body = ["", theme.fg("muted", `  ${p.emptyMessage ?? "No messages."}`)];
	} else {
		const all = layoutBlocks(p.blocks, inner, theme);
		const start = Math.min(Math.max(0, p.scroll), Math.max(0, all.length - visible));
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
