/**
 * Changelog dialog (`@`, global): pi's `/changelog` in a big scrollable box.
 *
 *   ┌─ What's New ─────────────────────────────── 1-38/2140 ─┐
 *   │ 0.85.1 - 2026-09-05                                    │
 *   │ ...                                                    │
 *   └────────────────────────────────────────────────────────┘
 *    CHANGELOG │ j/k scroll  ctrl+d/u page  g/G top/bottom  Esc close
 *
 * The markdown is rendered with pi-tui's `Markdown` (CLAUDE.md rule 8) once per
 * width and cached; the box takes the whole terminal but a 2-column / 1-row
 * margin, like the tree dialog. `j` `k` `↑` `↓` scroll a line, `ctrl+d` /
 * `ctrl+u` / PageDown / PageUp half a page, `g` / `G` jump to the top / bottom,
 * Esc / `q` close (the panel also closes it on its own `@` key). Every other key
 * is swallowed. Loading the file is the panel's job (data/changelog.ts).
 *
 * changelog 弹窗：只管画和滚动；Markdown 按宽度缓存，内容由面板通过 DataSource 加载。
 */

import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { matchesKeyId } from "../../config/keys.ts";
import type { KeyHint } from "../../types.ts";
import { frame, overlayCentered } from "../frame.ts";

/** Title on the top border (pi's own heading for /changelog). */
export const CHANGELOG_TITLE = "What's New";

/** Footer hints while the dialog is open. */
export const CHANGELOG_HINTS: KeyHint[] = [
	["j/k", "scroll"],
	["ctrl+d/u", "page"],
	["g/G", "top/bottom"],
	["Esc", "close"],
];

export interface ChangelogDialogOptions {
	theme: Theme;
	onClose: () => void;
}

export class ChangelogDialog {
	private markdown: string | undefined;
	private scroll = 0;
	/** Rendered lines for the last width. */
	private cache: { width: number; lines: string[] } | undefined;
	/** Body rows visible at the last render, for paging and clamping. */
	private visible = 10;

	constructor(private readonly o: ChangelogDialogOptions) {}

	get isOpen(): boolean {
		return this.markdown !== undefined;
	}

	get hints(): KeyHint[] {
		return this.isOpen ? CHANGELOG_HINTS : [];
	}

	/** Current top line (for tests). */
	get scrollTop(): number {
		return this.scroll;
	}

	open(markdown: string): void {
		this.markdown = markdown;
		this.scroll = 0;
		this.cache = undefined;
	}

	close(): void {
		this.markdown = undefined;
		this.cache = undefined;
	}

	handleInput(data: string): void {
		if (!this.isOpen) return;
		const half = Math.max(1, Math.floor(this.visible / 2));
		if (matchesKeyId(data, "escape") || matchesKeyId(data, "q")) this.o.onClose();
		else if (matchesKeyId(data, "j") || matchesKeyId(data, "down")) this.scrollBy(1);
		else if (matchesKeyId(data, "k") || matchesKeyId(data, "up")) this.scrollBy(-1);
		else if (matchesKeyId(data, "ctrl+d") || matchesKeyId(data, "pagedown")) this.scrollBy(half);
		else if (matchesKeyId(data, "ctrl+u") || matchesKeyId(data, "pageup")) this.scrollBy(-half);
		else if (matchesKeyId(data, "g")) this.scroll = 0;
		else if (matchesKeyId(data, "shift+g")) this.scroll = Number.MAX_SAFE_INTEGER;
		// 其他按键一律吞掉；越界的滚动位置在 render 时夹回来。
	}

	private scrollBy(delta: number): void {
		this.scroll = Math.max(0, this.scroll + delta);
	}

	private lines(width: number): string[] {
		if (this.cache?.width === width) return this.cache.lines;
		const md = new Markdown(this.markdown ?? "", 1, 0, getMarkdownTheme());
		const lines = md.render(width);
		this.cache = { width, lines };
		return lines;
	}

	/** Box size for a `termW` × `termH` terminal (same margins as the tree dialog). */
	static size(termW: number, termH: number): { width: number; height: number } {
		return { width: Math.max(24, termW - 4), height: Math.max(5, termH - 2) };
	}

	/** Render the box itself, every line exactly `width` columns and `height` lines tall. */
	render(width: number, height: number): string[] {
		const { theme } = this.o;
		const all = this.lines(width - 2);
		this.visible = Math.max(1, height - 2);
		const maxTop = Math.max(0, all.length - this.visible);
		this.scroll = Math.min(this.scroll, maxTop);
		const body = all.slice(this.scroll, this.scroll + this.visible);
		const last = Math.min(all.length, this.scroll + this.visible);
		const meta = all.length > this.visible ? `${this.scroll + 1}-${last}/${all.length}` : "";
		return frame(body, {
			width,
			height,
			title: CHANGELOG_TITLE,
			...(meta ? { meta } : {}),
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
			metaStyle: (s) => theme.fg("dim", s),
		});
	}

	/** Composite the box centered over the already-rendered panel `lines`. */
	overlay(lines: string[], termW: number): string[] {
		const { width, height } = ChangelogDialog.size(termW, lines.length);
		return overlayCentered(lines, this.render(width, height), width, termW);
	}
}
