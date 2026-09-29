/** Scrollable prompt preview owned by ContextUsageDialog; Esc only returns to its list. */
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { matchesKeyId } from "../../config/keys.ts";
import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";
import { normalizeNewlines } from "../../utils/format.ts";
import { FRAME_DIVIDER, frame, overlayCentered } from "../frame.ts";

import { renderDialogHints } from "./dialog-hints.ts";

interface PromptDetailSpec {
	category: string;
	prompt: string;
	onCopy: (text: string) => void;
}

export class PromptDetailDialog {
	private spec: PromptDetailSpec | undefined;
	private scroll = 0;
	private visible = 1;
	private cache: { width: number; lines: string[] } | undefined;

	constructor(private readonly theme: Theme) {}

	get isOpen(): boolean {
		return this.spec !== undefined;
	}

	get hints(): KeyHint[] {
		return [
			["j/k/↑↓", t("hint.scroll")],
			["ctrl+d/u", t("hint.page")],
			["g/G", t("hint.topBottom")],
			["y", t("hint.copy")],
			["Esc", t("hint.back")],
		];
	}

	open(spec: PromptDetailSpec): void {
		this.spec = spec;
		this.scroll = 0;
		this.cache = undefined;
	}

	close(): void {
		this.spec = undefined;
		this.scroll = 0;
		this.cache = undefined;
	}

	handleInput(data: string): void {
		if (!this.spec) return;
		if (matchesKeyId(data, "escape") || matchesKeyId(data, "q")) {
			this.close();
			return;
		}
		if (matchesKeyId(data, "y")) {
			this.spec.onCopy(this.spec.prompt);
			return;
		}
		const half = Math.max(1, Math.floor(this.visible / 2));
		if (matchesKeyId(data, "j") || matchesKeyId(data, "down")) this.scrollBy(1);
		else if (matchesKeyId(data, "k") || matchesKeyId(data, "up")) this.scrollBy(-1);
		else if (matchesKeyId(data, "ctrl+d") || matchesKeyId(data, "pagedown")) this.scrollBy(half);
		else if (matchesKeyId(data, "ctrl+u") || matchesKeyId(data, "pageup")) this.scrollBy(-half);
		else if (matchesKeyId(data, "g")) this.scroll = 0;
		else if (matchesKeyId(data, "shift+g")) this.scroll = Number.MAX_SAFE_INTEGER;
	}

	private scrollBy(delta: number): void {
		const max = this.cache ? Math.max(0, this.cache.lines.length - this.visible) : Number.MAX_SAFE_INTEGER;
		this.scroll = Math.min(max, Math.max(0, this.scroll + delta));
	}

	render(width: number, height: number): string[] {
		const { theme } = this;
		const hints = renderDialogHints(this.hints, theme, width - 2, Math.max(0, height - 4));
		const hintHeight = hints.length ? hints.length + 1 : 0;
		this.visible = Math.max(1, height - 2 - hintHeight);
		if (!this.cache || this.cache.width !== width) {
			const text = normalizeNewlines(this.spec?.prompt || t("usage.emptyPrompt"));
			const md = new Markdown(text, 1, 0, getMarkdownTheme());
			this.cache = { width, lines: md.render(Math.max(1, width - 2)) };
		}
		const all = this.cache.lines;
		this.scroll = Math.min(this.scroll, Math.max(0, all.length - this.visible));
		const last = Math.min(all.length, this.scroll + this.visible);
		const body = Array.from({ length: this.visible }, (_, i) => all[this.scroll + i] ?? "");
		if (hints.length) body.push(FRAME_DIVIDER, ...hints);
		return frame(body, {
			width,
			height,
			title: t("dialog.promptDetailTitle", { category: this.spec?.category ?? "" }),
			...(all.length > this.visible ? { meta: `${this.scroll + 1}-${last}/${all.length}` } : {}),
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
			metaStyle: (s) => theme.fg("dim", s),
		});
	}

	overlay(lines: string[], termW: number): string[] {
		const width = Math.min(termW, Math.max(4, termW - 4));
		const height = Math.min(lines.length, Math.max(2, lines.length - 2));
		return overlayCentered(lines, this.render(width, height), width, termW);
	}
}
