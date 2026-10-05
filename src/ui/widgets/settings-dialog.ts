/** Read-only settings browser. Configuration comes from the panel, never from disk. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ResolvedConfig } from "../../config/config.ts";
import { actionDescription, DEFAULT_KEYMAP, scopeTitle } from "../../config/keymap.ts";
import { labelsFor, matchesKeyId } from "../../config/keys.ts";
import { KEY_SCOPES } from "../../constants.ts";
import { currentLocale, t } from "../../i18n/index.ts";
import type { ActionId, KeyHint } from "../../types.ts";
import { clamp } from "../../utils/indices.ts";
import { fit, frame, FRAME_DIVIDER, overlayCentered } from "../frame.ts";
import { SETTINGS_CATEGORIES, type SettingsPosition, type SettingsRegion, type SettingsState } from "../settings-state.ts";
import { dialogHeader } from "./dialog-header.ts";

const FRAME_MS = 30;
const FRAME_STEP = 1 / 4;
const REGIONS: SettingsRegion[] = ["categories", "list", "buttons"];

type SettingsSnapshot = Readonly<Omit<ResolvedConfig, "warnings">>;

interface SettingsItem {
	id: string;
	label: string;
	value: string;
	description: string;
}

export interface SettingsDialogOptions {
	state: SettingsState;
	config: SettingsSnapshot;
	theme: Theme;
	onChange: () => void;
	onClose: () => void;
}

export class SettingsDialog {
	private timer: ReturnType<typeof setInterval> | undefined;
	private disposed = false;

	constructor(private readonly o: SettingsDialogOptions) {}

	get isOpen(): boolean {
		return this.o.state.phase !== "closed";
	}

	get hints(): KeyHint[] {
		const hints: KeyHint[] = [["Esc/q", t("hint.close")]];
		if (this.o.state.phase !== "open") return hints;
		hints.push(["Tab/Shift+Tab", t("settings.switchRegion")], ["j/k/↑↓", t("hint.move")]);
		if (this.o.state.region === "list" && this.o.state.category === "keybindings") {
			hints.push(["h/l/←→", t("settings.switchScope")]);
		} else if (this.o.state.region !== "list") {
			hints.push(["Enter", t(this.o.state.region === "buttons" ? "hint.close" : "hint.preview")]);
		}
		if (this.o.state.region === "list") hints.push(["PgUp/PgDn", t("settings.scrollDetails")]);
		return hints;
	}

	open(): void {
		if (this.disposed || this.isOpen) return;
		this.o.state.phase = "opening";
		this.o.state.progress = 0;
		this.o.state.region = "categories";
		this.animate();
		this.o.onChange();
	}

	close(): void {
		if (!this.isOpen || this.o.state.phase === "closing") return;
		this.o.state.phase = "closing";
		this.animate();
		this.o.onChange();
	}

	private animate(): void {
		this.stopTimer();
		this.timer = setInterval(() => {
			if (this.disposed) return;
			const state = this.o.state;
			state.progress = clamp(state.progress + (state.phase === "closing" ? -FRAME_STEP : FRAME_STEP), 0, 1);
			if (state.progress === 0 || state.progress === 1) {
				this.stopTimer();
				state.phase = state.progress === 0 ? "closed" : "open";
				if (state.phase === "closed") this.o.onClose();
			}
			this.o.onChange();
		}, FRAME_MS);
		this.timer.unref?.();
	}

	private stopTimer(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	dispose(): void {
		this.disposed = true;
		this.stopTimer();
		this.o.state.phase = "closed";
		this.o.state.progress = 0;
	}

	handleInput(data: string): void {
		if (!this.isOpen || this.disposed) return;
		if (matchesKeyId(data, "escape") || matchesKeyId(data, "q")) {
			this.close();
			return;
		}
		// 收起完之前仍然是模态；展开时仅允许取消，不把导航或重复关闭漏给背景。
		if (this.o.state.phase !== "open") return;
		const state = this.o.state;
		if (matchesKeyId(data, "tab") || matchesKeyId(data, "shift+tab")) {
			const step = matchesKeyId(data, "shift+tab") ? -1 : 1;
			state.region = REGIONS[(REGIONS.indexOf(state.region) + step + REGIONS.length) % REGIONS.length]!;
		} else if (matchesKeyId(data, "return")) {
			if (state.region === "buttons") this.close();
			else if (state.region === "categories") state.region = "list";
		} else if (matchesKeyId(data, "j") || matchesKeyId(data, "down")) {
			this.move(1);
		} else if (matchesKeyId(data, "k") || matchesKeyId(data, "up")) {
			this.move(-1);
		} else if (state.region === "list" && (matchesKeyId(data, "pageup") || matchesKeyId(data, "pagedown"))) {
			const position = this.position();
			position.detailScroll = Math.max(0, position.detailScroll + (matchesKeyId(data, "pageup") ? -3 : 3));
		} else if (state.region === "list" && state.category === "keybindings") {
			let step = 0;
			if (matchesKeyId(data, "h") || matchesKeyId(data, "left")) step = -1;
			if (matchesKeyId(data, "l") || matchesKeyId(data, "right")) step = 1;
			state.keyScope = KEY_SCOPES[(KEY_SCOPES.indexOf(state.keyScope) + step + KEY_SCOPES.length) % KEY_SCOPES.length]!;
		}
		this.o.onChange();
	}

	private move(delta: number): void {
		const state = this.o.state;
		if (state.region === "categories") {
			state.category = SETTINGS_CATEGORIES[clamp(SETTINGS_CATEGORIES.indexOf(state.category) + delta, 0, SETTINGS_CATEGORIES.length - 1)]!;
		} else if (state.region === "list") {
			const position = this.position();
			position.cursor = clamp(position.cursor + delta, 0, Math.max(0, this.items().length - 1));
			position.detailScroll = 0;
		}
	}

	private position(): SettingsPosition {
		const state = this.o.state;
		const page = state.category === "keybindings" ? state.keyScope : state.category;
		return state.positions[page] ??= { cursor: 0, scroll: 0, detailScroll: 0 };
	}

	private items(): SettingsItem[] {
		const { config, state } = this.o;
		switch (state.category) {
			case "general":
				return [
					{ id: "locale", label: t("settings.locale"), value: config.locale ? t(`settings.language.${config.locale}`) : t("settings.systemLanguage", { language: t(`settings.language.${currentLocale()}`) }), description: t("settings.localeDescription") },
					{ id: "defaultScope", label: t("settings.defaultScope"), value: t(`settings.scope.${config.defaultScope}`), description: t("settings.defaultDescription") },
					{ id: "defaultSort", label: t("settings.defaultSort"), value: t(`settings.sort.${config.defaultSort}`), description: t("settings.defaultDescription") },
				];
			case "layout":
				return [{ id: "leftColumnRatio", label: t("settings.leftWidth"), value: `${Number((config.leftColumnRatio * 100).toFixed(2))}%`, description: t("settings.widthDescription") }];
			case "theme":
				return [{ id: "", label: t("settings.category.theme"), value: t("settings.followPi"), description: t("settings.themeDescription") }];
			case "keybindings": {
				// 本层合并结果，不使用会展开继承的 help/labelsForFocus；默认表只用于保留已解绑的动作行。
				const actions = new Set([...Object.keys(DEFAULT_KEYMAP[state.keyScope]), ...Object.keys(config.keymap[state.keyScope])]);
				return [...actions].map((id) => ({
					id,
					label: actionDescription(id as ActionId),
					value: labelsFor(config.keymap, state.keyScope, id as ActionId).join(" / ") || t("settings.unbound"),
					description: t("settings.layerDescription"),
				}));
			}
		}
	}

	private selected(text: string, width: number, selected: boolean, focused: boolean): string {
		const { theme } = this.o;
		const line = fit(`${selected ? "›" : " "} ${text}`, width);
		if (!selected) return theme.fg("text", line);
		return focused ? theme.bg("selectedBg", theme.fg("accent", line)) : theme.fg("accent", line);
	}

	/** Lay out the complete final box, independent of animation progress. */
	render(width: number, height: number): string[] {
		const { state, theme } = this.o;
		if (width < 16 || height < 7) {
			return Array.from({ length: Math.max(0, height) }, (_, i) => fit(i === 0 ? `Esc ${t("hint.close")}` : i === 1 ? t("settings.title") : "", width));
		}
		const inner = width - 2;
		const areaHeight = height - 5; // borders + notice + divider + close button
		const wide = width >= 76;
		const sidebarWidth = wide ? Math.max(16, ...SETTINGS_CATEGORIES.map((c) => visibleWidth(t(`settings.category.${c}`)) + 4)) : 0;
		const contentWidth = wide ? inner - sidebarWidth - 3 : inner - 2;
		const category = t(`settings.category.${state.category}`);
		const heading = state.category === "keybindings" ? `${scopeTitle(state.keyScope)}  ·  h/l/←→` : category;
		let area: string[];
		if (wide) {
			const content = this.renderContent(contentWidth, areaHeight - 1);
			const categoryStart = clamp(SETTINGS_CATEGORIES.indexOf(state.category) - (areaHeight - 2), 0, SETTINGS_CATEGORIES.length - 1);
			area = Array.from({ length: areaHeight }, (_, i) => {
				const cat = SETTINGS_CATEGORIES[i - 1 + categoryStart];
				const left = i === 0 ? theme.fg("muted", fit(t("settings.categories"), sidebarWidth)) : cat ? this.selected(t(`settings.category.${cat}`), sidebarWidth, cat === state.category, state.region === "categories") : fit("", sidebarWidth);
				const right = i === 0 ? theme.bold(theme.fg("accent", heading)) : content[i - 1] ?? "";
				return `${left} ${theme.fg("borderMuted", "│")} ${fit(right, contentWidth)}`;
			});
		} else {
			const title = `${SETTINGS_CATEGORIES.indexOf(state.category) + 1}/4 ${category}`;
			area = [this.selected(title, inner, true, state.region === "categories")];
			if (state.category === "keybindings" && areaHeight > 2) area.push(` ${heading}`);
			area.push(...this.renderContent(contentWidth, areaHeight - area.length).map((line) => ` ${line}`));
		}
		const close = this.selected(`[ ${t("settings.close")} ]`, inner, state.region === "buttons", state.region === "buttons");
		return frame([
			theme.fg("dim", fit(` ${t("settings.readOnlyNotice")}`, inner)),
			...area,
			FRAME_DIVIDER,
			close,
		], {
			width,
			height,
			...dialogHeader(width, `${t("settings.title")} · ${t("settings.readOnly")}`),
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
			metaStyle: (s) => theme.fg("dim", s),
		});
	}

	private renderContent(width: number, height: number): string[] {
		if (height <= 0) return [];
		const { theme, state } = this.o;
		const items = this.items();
		const pos = this.position();
		pos.cursor = clamp(pos.cursor, 0, Math.max(0, items.length - 1));
		const item = items[pos.cursor];
		if (!item) return [fit(t("settings.noBindings"), width)];
		const detail = [item.id, `${item.label}: ${item.value}`, item.description].filter(Boolean).flatMap((text) => wrapTextWithAnsi(text, Math.max(1, width)));
		const detailHeight = height >= 8 ? Math.min(detail.length, Math.floor(height / 2)) : 0;
		const listHeight = height - (detailHeight ? detailHeight + 1 : 0);
		const rowHeight = width < 50 && listHeight >= 2 ? 2 : 1;
		const capacity = Math.max(1, Math.floor(listHeight / rowHeight));
		pos.scroll = clamp(pos.scroll, Math.max(0, pos.cursor - capacity + 1), pos.cursor);
		pos.scroll = Math.min(pos.scroll, Math.max(0, items.length - capacity));
		const lines: string[] = [];
		for (let i = pos.scroll; i < Math.min(items.length, pos.scroll + capacity); i++) {
			const row = items[i]!;
			const isSelected = i === pos.cursor;
			if (rowHeight === 2) {
				lines.push(this.selected(row.label, width, isSelected, state.region === "list"));
				lines.push(theme.fg("muted", fit(`  ${row.value}`, width)));
			} else {
				const valueWidth = Math.min(Math.max(12, visibleWidth(row.value)), Math.floor(width / 2));
				lines.push(this.selected(`${fit(row.label, Math.max(0, width - valueWidth - 4))}  ${fit(row.value, valueWidth)}`, width, isSelected, state.region === "list"));
			}
		}
		while (lines.length < listHeight) lines.push("");
		if (detailHeight) {
			pos.detailScroll = clamp(pos.detailScroll, 0, Math.max(0, detail.length - detailHeight));
			const meta = `${pos.cursor + 1}/${items.length}  ${pos.detailScroll > 0 ? "↑ " : ""}${pos.detailScroll + detailHeight < detail.length ? "↓ PgDn" : ""}`.trimEnd();
			lines.push(theme.fg("dim", fit(`${meta} ${"─".repeat(Math.max(0, width - visibleWidth(meta) - 1))}`, width)));
			lines.push(...detail.slice(pos.detailScroll, pos.detailScroll + detailHeight).map((line) => theme.fg("muted", fit(line, width))));
		}
		return lines;
	}

	overlay(lines: string[], termW: number): string[] {
		const width = Math.max(0, Math.min(termW, termW - (termW >= 24 ? 4 : 0), 112));
		const height = Math.max(0, Math.min(lines.length, lines.length - (lines.length >= 9 ? 2 : 0), 30));
		const full = this.render(width, height);
		// 先排终态再裁切：固定顶部与文字位置，只让底边向下展开，避免每帧重排/居中跳动。
		const shown = Math.min(height, Math.max(2, Math.round(height * this.o.state.progress)));
		const box = shown < height ? [...full.slice(0, shown - 1), full[height - 1]!] : full;
		const top = Math.max(0, Math.floor((lines.length - height) / 2));
		return overlayCentered(lines, box, width, termW, (s) => this.o.theme.fg("dim", s), top);
	}
}
