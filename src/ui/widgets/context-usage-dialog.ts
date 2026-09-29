/**
 * Context usage dialog (`u` in the sessions pane): how full the model's
 * context window is for a session and what fills it — pi's footer percentage,
 * broken down like pi-cc's `/context` command, in a box centered over the panel.
 *
 *   ┌─ Context Usage ─────────────────────── claude-opus-4 ─┐
 *   │ 84.2k / 200k · 42%                                     │
 *   │ ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
 *   │                                                        │
 *   │ ■ System prompt      1.7k    0.9%                      │
 *   │ ■ Memory               19    0.0%                      │
 *   │ ■ Skills              363    0.2%                      │
 *   │ ■ Tools definition    5.2k   2.6%                      │
 *   │ ■ Tool results       40.0k  20.0%                      │
 *   │ ■ Context            36.7k  18.4%                      │
 *   │ ■ Other                 0    0.0%                      │
 *   │ ■ Free space        115.8k  57.9%                      │
 *   │                                                        │
 *   │ Model     claude-opus-4                                │
 *   │ Messages  12                                           │
 *   └────────────────────────────────────────────────────────┘
 *    USAGE │ j/k/↑↓ select   Enter preview   y copy   Esc close
 *
 * j/k or arrows select a category; Enter previews its prompt in a nested
 * Markdown dialog. Esc returns to this list without losing the selection.
 * y copies the current view; statistics-only rows have no prompt to preview.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { usageSegments } from "../../data/context-usage.ts";
import { matchesKeyId } from "../../config/keys.ts";
import { t } from "../../i18n/index.ts";
import type { ContextUsageCategory, ContextUsageInfo, KeyHint } from "../../types.ts";
import { formatCost, formatTokens } from "../../utils/format.ts";
import { dialogWidth, fit, FRAME_DIVIDER, frame, metaBudget, overlayCentered } from "../frame.ts";

import { renderDialogHints } from "./dialog-hints.ts";
import { PromptDetailDialog } from "./prompt-detail-dialog.ts";

/** Title on the top border (localised). */
export function contextUsageTitle(): string {
	return t("dialog.contextUsageTitle");
}

/** Footer hints while the dialog is open. */
export function contextUsageHints(): KeyHint[] {
	return [
		["j/k/↑↓", t("hint.select")],
		["Enter", t("hint.preview")],
		["y", t("hint.copy")],
		["Esc", t("hint.close")],
	];
}

/** Width of the label column ("Tools definition" is the longest). */
const LABEL_WIDTH = 16;

export interface ContextUsageDialogSpec {
	info: ContextUsageInfo;
	/** `y`: receives the summary (`contextUsageText`) or the open category's prompt. */
	onCopy: (text: string) => void;
	onClose: () => void;
}

export interface ContextUsageDialogOptions {
	theme: Theme;
}

/** Localised label of a category (`usage.<key>`). */
function categoryLabel(key: string): string {
	return t(`usage.${key}`);
}

/** "42%" from a 0..1 fraction. */
function formatPercent(fraction: number): string {
	return `${(clamp01(fraction) * 100).toFixed(1)}%`;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Per-category percentage of the whole window; falls back to a share of `used` when the window is unknown. */
function categoryFraction(info: ContextUsageInfo, tokens: number): number | undefined {
	if (info.contextWindow) return tokens / info.contextWindow;
	if (info.used > 0) return tokens / info.used;
	return undefined;
}

/** The window line: "84.2k / 200k · 42%", or "84.2k used · window unknown" when the window is unknown. */
function windowSummary(info: ContextUsageInfo): string {
	const used = formatTokens(info.used);
	if (info.contextWindow === undefined || info.percent === undefined) return t("usage.usedNoWindow", { used });
	return t("usage.usedOfWindow", { used, window: formatTokens(info.contextWindow), percent: formatPercent(info.percent) });
}

/** "auto-compact at 92% (~99.6k left)", or empty when the window is unknown. */
function autoCompactHint(info: ContextUsageInfo): string {
	if (info.compactThreshold === undefined) return "";
	const at = formatPercent(info.compactThreshold);
	if (info.compactRemaining === undefined) return t("usage.autoCompactAt", { percent: at });
	return t("usage.autoCompactLeft", { percent: at, left: formatTokens(info.compactRemaining) });
}

/** Pad `text` to at least `width` visible columns (wide chars count as two). */
function padColumns(text: string, width: number): string {
	const extra = width - visibleWidth(text);
	return extra > 0 ? text + " ".repeat(extra) : text;
}

/** The `tokens  pct%` cell of a category row, aligned. */
function amountCell(info: ContextUsageInfo, category: ContextUsageCategory): string {
	const tokens = formatTokens(category.tokens).padStart(7);
	const fraction = categoryFraction(info, category.tokens);
	return fraction === undefined ? tokens : `${tokens}  ${formatPercent(fraction).padStart(6)}`;
}

/** What `y` copies: the window line, one `Label  tokens pct%` per category, then the summary. */
export function contextUsageText(info: ContextUsageInfo): string {
	const lines = [windowSummary(info)];
	const auto = autoCompactHint(info);
	if (auto) lines.push(auto);
	lines.push("");
	for (const category of info.categories) lines.push(`${padColumns(categoryLabel(category.key), LABEL_WIDTH)} ${amountCell(info, category).trim()}`);
	lines.push("");
	lines.push(`${padColumns(t("usage.model"), LABEL_WIDTH)} ${info.model ?? t("info.unknown")}`);
	lines.push(`${padColumns(t("usage.messages"), LABEL_WIDTH)} ${info.messages}`);
	if (info.cost !== undefined) lines.push(`${padColumns(t("usage.cost"), LABEL_WIDTH)} ${formatCost(info.cost)}`);
	return lines.join("\n");
}

export class ContextUsageDialog {
	private spec: ContextUsageDialogSpec | undefined;
	private selected = -1;
	private scroll = 0;
	private readonly detail: PromptDetailDialog;

	constructor(private readonly o: ContextUsageDialogOptions) {
		this.detail = new PromptDetailDialog(o.theme);
	}

	/** True between `open` and `close`. */
	get isOpen(): boolean {
		return this.spec !== undefined;
	}

	/** Footer hints while open (empty when closed). */
	get hints(): KeyHint[] {
		return this.spec ? (this.detail.isOpen ? this.detail.hints : contextUsageHints()) : [];
	}

	open(spec: ContextUsageDialogSpec): void {
		this.detail.close();
		this.spec = spec;
		this.selected = spec.info.categories.findIndex((category) => category.prompt !== undefined);
		this.scroll = 0;
	}

	/** Drop the dialog without firing a callback. */
	close(): void {
		this.spec = undefined;
		this.detail.close();
	}

	handleInput(data: string): void {
		const spec = this.spec;
		if (!spec) return;
		// 子弹窗先消费 Esc，不能顺手把父弹窗也关掉。
		if (this.detail.isOpen) {
			this.detail.handleInput(data);
			return;
		}
		if (matchesKeyId(data, "escape") || matchesKeyId(data, "q")) {
			spec.onClose();
			return;
		}
		if (matchesKeyId(data, "j") || matchesKeyId(data, "down")) this.move(1);
		else if (matchesKeyId(data, "k") || matchesKeyId(data, "up")) this.move(-1);
		else if (matchesKeyId(data, "enter")) {
			const category = spec.info.categories[this.selected];
			if (category?.prompt !== undefined) {
				this.detail.open({ category: categoryLabel(category.key), prompt: category.prompt, onCopy: spec.onCopy });
			}
		} else if (matchesKeyId(data, "y")) spec.onCopy(contextUsageText(spec.info));
		// 其他按键一律吞掉，不能漏到下面的面板去。
	}

	private move(delta: number): void {
		const categories = this.spec?.info.categories ?? [];
		for (let i = this.selected + delta; i >= 0 && i < categories.length; i += delta) {
			if (categories[i]?.prompt !== undefined) {
				this.selected = i;
				return;
			}
		}
	}

	/** Render the box itself, every line exactly `width` columns. */
	render(width: number, height?: number): string[] {
		const info = this.spec?.info;
		const inner = width - 2;
		const hints = renderDialogHints(contextUsageHints(), this.o.theme, inner, height === undefined ? Infinity : Math.max(0, height - 4));
		const hintHeight = hints.length ? hints.length + 1 : 0;
		let body = info ? this.renderBody(info, inner) : [];
		if (height !== undefined) {
			const visible = Math.max(1, height - 2 - hintHeight);
			const firstCategory = 2 + (info && autoCompactHint(info) ? 1 : 0) + (info?.contextWindow && inner > 2 ? 1 : 0);
			const selectedLine = firstCategory + Math.max(0, this.selected);
			this.scroll = Math.max(0, Math.min(this.scroll, selectedLine, body.length - visible));
			if (selectedLine >= this.scroll + visible) this.scroll = selectedLine - visible + 1;
			body = body.slice(this.scroll, this.scroll + visible);
		}
		// 提示固定在弹窗底部，不随分类列表滚动，也不受主面板状态文字挤占。
		if (hints.length) body.push(FRAME_DIVIDER, ...hints);
		const { theme } = this.o;
		const subject = info?.model ?? "";
		const meta = truncateToWidth(subject, metaBudget(width, contextUsageTitle()) - 3, "…", false);
		return frame(body, {
			width,
			height: body.length + 2,
			title: contextUsageTitle(),
			...(meta ? { meta } : {}),
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
			metaStyle: (s) => theme.fg("dim", s),
		});
	}

	/** Window line + stacked bar + category rows + summary, styled. */
	private renderBody(info: ContextUsageInfo, inner: number): string[] {
		const { theme } = this.o;
		const lines: string[] = [];
		lines.push(` ${theme.fg("text", truncateToWidth(windowSummary(info), inner - 1, "…", false))}`);
		const auto = autoCompactHint(info);
		if (auto) lines.push(` ${theme.fg("muted", truncateToWidth(auto, inner - 1, "…", false))}`);
		const bar = this.renderBar(info, inner - 2);
		if (bar) lines.push(` ${bar}`);
		lines.push("");
		for (const [index, category] of info.categories.entries()) {
			const swatch = theme.fg(category.color, "■");
			const label = padColumns(categoryLabel(category.key), LABEL_WIDTH);
			const selected = index === this.selected;
			const row = `${selected ? "›" : " "} ${swatch} ${theme.fg(category.color, label)} ${theme.fg("text", amountCell(info, category))}`;
			lines.push(selected ? theme.bg("selectedBg", fit(row, inner)) : row);
		}
		lines.push(FRAME_DIVIDER);
		lines.push(` ${theme.fg("muted", padColumns(t("usage.model"), LABEL_WIDTH))} ${theme.fg("text", info.model ?? t("info.unknown"))}`);
		lines.push(` ${theme.fg("muted", padColumns(t("usage.messages"), LABEL_WIDTH))} ${theme.fg("text", String(info.messages))}`);
		if (info.cost !== undefined) lines.push(` ${theme.fg("muted", padColumns(t("usage.cost"), LABEL_WIDTH))} ${theme.fg("text", formatCost(info.cost))}`);
		return lines;
	}

	/** A single stacked bar, one colored `█` run per category proportional to its share of the window. */
	private renderBar(info: ContextUsageInfo, width: number): string | undefined {
		if (!info.contextWindow || width <= 0) return undefined;
		const { theme } = this.o;
		const cells = usageSegments(info.categories.map((c) => c.tokens), info.contextWindow, width);
		return info.categories.map((c, i) => theme.fg(c.color, "█".repeat(cells[i] ?? 0))).join("");
	}

	/** Composite the box centered over the already-rendered panel `lines`. */
	overlay(lines: string[], termW: number): string[] {
		if (this.detail.isOpen) return this.detail.overlay(lines, termW);
		const width = Math.min(termW, dialogWidth(termW));
		return overlayCentered(lines, this.render(width, lines.length), width, termW);
	}
}
