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
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { SPINNER_FRAMES } from "../../constants.ts";
import { matchesKeyId } from "../../config/keys.ts";
import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";
import { frame, overlayCentered } from "../frame.ts";

/** Title on the top border (pi's own heading for /changelog, localised). */
export function changelogTitle(): string {
	return t("dialog.changelogTitle");
}

/** Loading line while the (large) changelog markdown is being rendered (localised). */
export function changelogLoading(): string {
	return t("dialog.changelogLoading");
}

/** Footer hints while the dialog is open. */
export function changelogHints(): KeyHint[] {
	return [
		["j/k", t("hint.scroll")],
		["ctrl+d/u", t("hint.page")],
		["g/G", t("hint.topBottom")],
		["Esc", t("hint.close")],
	];
}

export interface ChangelogDialogOptions {
	theme: Theme;
	onClose: () => void;
}

export class ChangelogDialog {
	private markdown: string | undefined;
	/** True between `openLoading()` and `setContent()` while the markdown is loaded / rendered. */
	private loading = false;
	/** Rotating-square frame index for the loading line, advanced by the panel. */
	private spinnerFrame = 0;
	private scroll = 0;
	/** Rendered lines cached by (width, markdown) so reopening the same changelog is instant. */
	private cache: { width: number; markdown: string; lines: string[] } | undefined;
	/** Body rows visible at the last render, for paging and clamping. */
	private visible = 10;

	constructor(private readonly o: ChangelogDialogOptions) {}

	get isOpen(): boolean {
		return this.loading || this.markdown !== undefined;
	}

	/** True while waiting for the changelog to load / render (the box shows the loading line). */
	get isLoading(): boolean {
		return this.loading;
	}

	get hints(): KeyHint[] {
		// 加载中不给滚动提示（还没内容可滚）；关闭时也没有。
		return this.markdown !== undefined ? changelogHints() : [];
	}

	/** Current top line (for tests). */
	get scrollTop(): number {
		return this.scroll;
	}

	/** Show the loading box while the markdown is fetched / rendered. */
	openLoading(): void {
		this.loading = true;
		this.markdown = undefined;
		this.spinnerFrame = 0;
		this.scroll = 0;
	}

	/** Advance the loading spinner one frame (driven by the panel's timer). */
	advanceSpinner(): void {
		this.spinnerFrame++;
	}

	/** Show the changelog content; the rendered lines are cached across opens so reopening is instant. */
	setContent(markdown: string): void {
		this.markdown = markdown;
		this.loading = false;
		this.scroll = 0;
		// 不主动清 cache：lines() 按 (width, markdown) 判断能否复用，同一份 changelog 再开就秒开。
	}

	close(): void {
		this.markdown = undefined;
		this.loading = false;
		// 保留 cache：同一宽度、同一份 changelog 下次打开直接复用渲染结果。
	}

	handleInput(data: string): void {
		if (!this.isOpen) return;
		// 加载中只允许取消（Esc / q），滚动等按键先吞掉。
		if (matchesKeyId(data, "escape") || matchesKeyId(data, "q")) {
			this.o.onClose();
			return;
		}
		if (this.loading) return;
		const half = Math.max(1, Math.floor(this.visible / 2));
		if (matchesKeyId(data, "j") || matchesKeyId(data, "down")) this.scrollBy(1);
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
		const markdown = this.markdown ?? "";
		if (this.cache?.width === width && this.cache.markdown === markdown) return this.cache.lines;
		const md = new Markdown(markdown, 1, 0, getMarkdownTheme());
		const lines = md.render(width);
		this.cache = { width, markdown, lines };
		return lines;
	}

	/** Box size for a `termW` × `termH` terminal (same margins as the tree dialog). */
	static size(termW: number, termH: number): { width: number; height: number } {
		return { width: Math.max(24, termW - 4), height: Math.max(5, termH - 2) };
	}

	/** Render the box itself, every line exactly `width` columns and `height` lines tall. */
	render(width: number, height: number): string[] {
		const { theme } = this.o;
		this.visible = Math.max(1, height - 2);
		if (this.loading) return this.renderLoading(width, height);
		const all = this.lines(width - 2);
		const maxTop = Math.max(0, all.length - this.visible);
		this.scroll = Math.min(this.scroll, maxTop);
		const body = all.slice(this.scroll, this.scroll + this.visible);
		const last = Math.min(all.length, this.scroll + this.visible);
		const meta = all.length > this.visible ? `${this.scroll + 1}-${last}/${all.length}` : "";
		return frame(body, {
			width,
			height,
			title: changelogTitle(),
			...(meta ? { meta } : {}),
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
			metaStyle: (s) => theme.fg("dim", s),
		});
	}

	/** The loading box: an empty body with a centered spinner + text in its middle. */
	private renderLoading(width: number, height: number): string[] {
		const { theme } = this.o;
		const inner = width - 2;
		const glyph = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
		const msg = `${glyph} ${changelogLoading()}`;
		const pad = Math.max(0, Math.floor((inner - visibleWidth(msg)) / 2));
		const body: string[] = Array.from({ length: this.visible }, () => "");
		// 垂直居中：放在中间那一行。
		body[Math.floor((this.visible - 1) / 2)] = " ".repeat(pad) + theme.fg("dim", msg);
		return frame(body, {
			width,
			height,
			title: changelogTitle(),
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
