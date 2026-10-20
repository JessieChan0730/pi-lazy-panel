/** Settings browser and draft editor. Configuration comes from the panel, never from disk. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ResolvedConfig } from "../../config/config.ts";
import { actionDescription, DEFAULT_KEYMAP, scopeTitle } from "../../config/keymap.ts";
import { labelsFor, matchesKeyId } from "../../config/keys.ts";
import { t } from "../../i18n/index.ts";
import type { ActionId, KeyHint } from "../../types.ts";
import { clamp } from "../../utils/indices.ts";
import { boxCell, centeredRect, fit, frame, FRAME_DIVIDER, overlayCentered, type BoxRect } from "../frame.ts";
import { keymapActionDirty, settingsDirtyCount, settingsDraft, settingsRetryKind, SETTINGS_CATEGORIES, type SettingsPosition, type SettingsRegion, type SettingsState } from "../settings-state.ts";
import { DIALOG_CLOSE_KEYS, dialogHeader } from "./dialog-header.ts";

const REGIONS: SettingsRegion[] = ["categories", "list", "buttons"];

type SettingsSnapshot = Readonly<Omit<ResolvedConfig, "warnings">>;

interface SettingsItem {
	id: string;
	label: string;
	value: string;
	/**
	 * 只有容易被误会的设置才写说明（布局宽度、快捷键的层级语义、主题切换失败……）。
	 * 说明是底部说明框存在的唯一理由：没有说明就不画那个框，其余设置靠行本身自解释。
	 * 框里只画这段说明——名字和值列表行上已经有了，再抄一遍只是噪音（连带光标也看得见是哪一条）。
	 */
	description?: string;
	/** True when the draft changes this item (shows the `*` marker). */
	dirty?: boolean;
}

export interface SettingsDialogOptions {
	state: SettingsState;
	config: SettingsSnapshot;
	theme: Theme;
	onChange: () => void;
	onClose: () => void;
	onExit?: () => void;
	onEdit?: (id: string) => void;
	/** `s`: redo whatever the last commit failed at (see `settingsRetryKind`). */
	onRetry?: () => void;
	onDefaults?: () => void;
	onReload?: () => void;
}

/**
 * One button of the settings main view. `key` is the shortcut that reaches it
 * from any region, and the label prints it: `[ s Retry ]`.
 */
interface SettingsButton {
	key: string;
	label: string;
	disabled: boolean;
	run: () => void;
}

/** 鼠标在设置页里命中的格子：区域 + 该区域里的下标（分类序号 / 设置行号 / 按钮号）。 */
export interface SettingsHit {
	region: SettingsRegion;
	index: number;
}

/**
 * 主对话框正文里的一段可点区域（侧栏一个分类 / 一条设置 / 一个按钮）。
 * 画每一行的时候顺手记下来（见 render），鼠标命中照着查，两边不会各算一套版式。
 */
interface SettingsClickable {
	/** 正文行号（0 = 上边框下面第一行）。 */
	row: number;
	/** 正文列区间 [from, to)。 */
	from: number;
	to: number;
	hit: SettingsHit;
}

export class SettingsDialog {
	private disposed = false;
	private lastFeedback = "";
	/** 上一次绘制里所有可点的格子（render 里清空重填）：鼠标点击照着画面查。 */
	private clickables: SettingsClickable[] = [];
	/** 上一次绘制时主对话框在屏幕上的位置（`overlay()` 里记）；鼠标命中只认这一份，没画过就点不到。 */
	private boxRect: BoxRect | undefined;

	constructor(private readonly o: SettingsDialogOptions) {}

	get isOpen(): boolean {
		return this.o.state.phase !== "closed";
	}

	get hints(): KeyHint[] {
		// 动作键（q 关闭 / d 恢复默认 / r 重新读取 / s 重试）由主框最下面的按钮行负责，标签上就带着直连键；
		// footer 只留没有按钮的导航键，同一套键不写两遍，也不会因为太长被从后面截掉。
		const scroll: KeyHint[] = this.detailItem()?.description || this.feedback().length ? [["PgUp/PgDn", t("settings.scrollDetails")]] : [];
		return [[DIALOG_CLOSE_KEYS, t("hint.close")], ["h/←", t("settings.categories")], ["l/→", t("settings.list")], ["Tab", t("settings.switchRegion")], ["j/k/↑↓", t("hint.move")], ["Enter", t("hint.choose")], ...scroll];
	}

	/** Is there a failed write / read for `s` to redo? */
	private retryable(): boolean {
		return settingsRetryKind(this.o.state) !== undefined;
	}

	/**
	 * The button bar. Retry is only listed while something actually failed, so
	 * the count moves — every reader goes through here and clamps `state.button`
	 * against it. The keys are the same ones that work from any region.
	 */
	private buttons(): SettingsButton[] {
		const { state } = this.o;
		const buttons: SettingsButton[] = [];
		if (this.retryable())
			buttons.push({ key: "s", label: t("settings.retry"), disabled: false, run: () => this.o.onRetry?.() });
		// 设置是改一项立刻落盘一项，这里出去不带任何回滚语义，所以是"关闭"不是"取消"
		// （和同一行的 Esc/q 提示用同一个词）。
		buttons.push({ key: "q", label: t("hint.close"), disabled: false, run: () => this.exit() });
		buttons.push({
			key: "d", label: t("settings.restore"), run: () => this.o.onDefaults?.(),
			// 主题页的 d 撤的是切换失败的那个主题；没有失败就没什么可撤的。
			disabled: state.loading || (state.category === "theme" ? state.themeDraft === undefined : !state.baseline),
		});
		buttons.push({ key: "r", label: t("settings.reload"), disabled: state.loading, run: () => this.o.onReload?.() });
		return buttons;
	}

	open(): void {
		if (this.disposed || this.isOpen) return;
		this.o.state.phase = "open";
		this.o.state.generation++;
		this.o.state.saving = false;
		this.o.state.region = "categories";
		this.o.onChange();
	}

	close(): void {
		if (!this.isOpen) return;
		this.o.state.phase = "closed";
		this.o.state.saving = false;
		this.o.state.loading = false;
		this.o.state.generation++;
		this.o.onClose();
		this.o.onChange();
	}

	dispose(): void {
		this.disposed = true;
		this.o.state.phase = "closed";
		this.o.state.saving = false;
		this.o.state.loading = false;
		this.o.state.generation++;
	}

	private exit(): void {
		if (this.o.onExit) this.o.onExit();
		else this.close();
	}

	handleInput(data: string): void {
		if (!this.isOpen || this.disposed || this.o.state.saving) return;
		if (matchesKeyId(data, "escape") || matchesKeyId(data, "q")) {
			this.exit();
			return;
		}
		const state = this.o.state;
		if (matchesKeyId(data, "tab") || matchesKeyId(data, "shift+tab")) {
			const step = matchesKeyId(data, "shift+tab") ? -1 : 1;
			state.region = REGIONS[(REGIONS.indexOf(state.region) + step + REGIONS.length) % REGIONS.length]!;
		} else if (matchesKeyId(data, "h") || matchesKeyId(data, "left")) {
			state.region = "categories";
		} else if (matchesKeyId(data, "l") || matchesKeyId(data, "right")) {
			state.region = "list";
		} else if (matchesKeyId(data, "s")) {
			this.o.onRetry?.();
		} else if (matchesKeyId(data, "d")) {
			this.o.onDefaults?.();
		} else if (matchesKeyId(data, "r")) {
			this.o.onReload?.();
		} else if (matchesKeyId(data, "return")) {
			this.activate();
			return;
		} else if (matchesKeyId(data, "j") || matchesKeyId(data, "down")) {
			this.move(1);
		} else if (matchesKeyId(data, "k") || matchesKeyId(data, "up")) {
			this.move(-1);
		} else if (matchesKeyId(data, "pageup") || matchesKeyId(data, "pagedown")) {
			const position = this.position();
			position.detailScroll = Math.max(0, position.detailScroll + (matchesKeyId(data, "pageup") ? -3 : 3));
		}
		this.o.onChange();
	}

	/** Enter（以及鼠标双击）：按当前区域执行 —— 分类进列表、设置行交给 onEdit、按钮直接运行。 */
	activate(): void {
		const state = this.o.state;
		if (state.region === "buttons") this.buttons()[this.buttonIndex()]?.run();
		else if (state.region === "categories") state.region = "list";
		else this.o.onEdit?.(this.items()[this.position().cursor]?.id ?? "");
		this.o.onChange();
	}

	/** j / k、方向键和滚轮：在当前区域里移动光标。 */
	move(delta: number): void {
		const state = this.o.state;
		if (state.region === "categories") {
			this.selectCategory(SETTINGS_CATEGORIES[clamp(SETTINGS_CATEGORIES.indexOf(state.category) + delta, 0, SETTINGS_CATEGORIES.length - 1)]!);
		} else if (state.region === "list") {
			const position = this.position();
			position.cursor = clamp(position.cursor + delta, 0, Math.max(0, this.items().length - 1));
			position.detailScroll = 0;
		} else {
			state.button = clamp(state.button + delta, 0, this.buttons().length - 1);
		}
	}

	private selectCategory(category: SettingsState["category"]): void {
		const state = this.o.state;
		if (state.category !== category) state.notice = undefined;
		state.category = category;
	}

	/**
	 * 屏幕上 (x, y) 命中的格子（照上一次绘制记下的可点区域）：边框、说明框、消息行、
	 * 侧栏和设置行之间的分隔列上返回 undefined。
	 */
	hitAt(x: number, y: number): SettingsHit | undefined {
		if (!this.mouseReady()) return undefined;
		const cell = this.boxRect ? boxCell(this.boxRect, x, y) : undefined;
		if (!cell) return undefined;
		return this.clickables.find((c) => c.row === cell.row && cell.col >= c.from && cell.col < c.to)?.hit;
	}

	/** 鼠标单击：区域和光标一起移到点中的那一格（分类栏切分类 / 设置行放光标 / 按钮栏选按钮）。 */
	focusHit(hit: SettingsHit): void {
		if (!this.mouseReady()) return;
		const state = this.o.state;
		if (hit.region === "categories") {
			const category = SETTINGS_CATEGORIES[hit.index];
			if (category) this.selectCategory(category);
		} else if (hit.region === "list") {
			const position = this.position();
			position.cursor = clamp(hit.index, 0, Math.max(0, this.items().length - 1));
			position.detailScroll = 0;
		} else {
			state.button = clamp(hit.index, 0, Math.max(0, this.buttons().length - 1));
		}
		state.region = hit.region;
		this.o.onChange();
	}

	/** 滚轮：作用于指针所在的区域（先切区域，不挪光标），指针不在可点格子上时不动。 */
	wheel(x: number, y: number, delta: number): void {
		if (delta === 0 || !this.mouseReady()) return;
		const hit = this.hitAt(x, y);
		if (!hit) return;
		this.o.state.region = hit.region;
		this.move(delta);
		this.o.onChange();
	}

	/** 鼠标入口统一的前置检查：弹窗开着、没被释放、也没有正在落盘的改动（和 handleInput 一致）。 */
	private mouseReady(): boolean {
		return this.isOpen && !this.disposed && !this.o.state.saving;
	}

	/** `state.button` clamped into the button bar, which grows and shrinks with the failures. */
	private buttonIndex(): number {
		const state = this.o.state;
		state.button = clamp(state.button, 0, Math.max(0, this.buttons().length - 1));
		return state.button;
	}

	private position(): SettingsPosition {
		const state = this.o.state;
		const page = state.category === "keybindings" ? state.keyScope : state.category;
		return state.positions[page] ??= { cursor: 0, scroll: 0, detailScroll: 0 };
	}

	/** The item under the cursor — the one the detail box (and its PgUp/PgDn hint) belongs to. */
	private detailItem(): SettingsItem | undefined {
		const items = this.items();
		return items[clamp(this.position().cursor, 0, Math.max(0, items.length - 1))];
	}

	private items(): SettingsItem[] {
		const { state } = this.o;
		const config = settingsDraft(state) ?? this.o.config;
		const dirty = (id: string): boolean => Object.hasOwn(state.patch, id);
		switch (state.category) {
			case "general":
				// 常规三项都自己说得清（语言 / 默认范围 / 默认排序），不写说明。
				return [
					{ id: "locale", label: t("settings.locale"), value: config.locale ? t(`settings.language.${config.locale}`) : t("settings.system"), dirty: dirty("locale") },
					{ id: "defaultScope", label: t("settings.defaultScope"), value: t(`settings.scope.${config.defaultScope}`), dirty: dirty("defaultScope") },
					{ id: "defaultSort", label: t("settings.defaultSort"), value: t(`settings.sort.${config.defaultSort}`), dirty: dirty("defaultSort") },
				];
			case "layout":
				// 宽度是容易误会的一项（谁跟谁共用、范围与默认值），保留说明。
				return [{ id: "leftColumnRatio", label: t("settings.leftWidth"), value: `${Number((config.leftColumnRatio * 100).toFixed(2))}%`, description: t("settings.widthDescription"), dirty: dirty("leftColumnRatio") }];
			case "theme":
				return this.themeItems();
			case "keybindings": {
				// 本层合并结果，不使用会展开继承的 help/labelsForFocus；默认表只用于保留已解绑的动作行。
				const actions = new Set([...Object.keys(DEFAULT_KEYMAP[state.keyScope]), ...Object.keys(config.keymap[state.keyScope])]);
				// 快捷键保留说明：这里"只显示本层"和"实际还受继承 / 优先级 / 禁用影响"最容易看错。
				// 说明框不再重复列表行，作用域名字要写进文案里（见 locales 的 scopeDescription / layerDescription）。
				const scope = scopeTitle(state.keyScope);
				return [{ id: "keyScope", label: t("settings.keyScope"), value: scope, description: t("settings.scopeDescription", { scope }) }, ...[...actions].map((id) => ({
					id,
					label: actionDescription(id as ActionId),
					value: labelsFor(config.keymap, state.keyScope, id as ActionId).join(" / ") || t("settings.unbound"),
					description: t("settings.layerDescription", { scope }),
					dirty: keymapActionDirty(state, state.keyScope, id as ActionId),
				}))];
			}
		}
	}

	/**
	 * The theme page is one row like every other setting: the value is the theme
	 * pi has active — or the one pi refused to switch to — and Enter opens the
	 * picker, which switches pi right away. 平时行上只有主题名，没有说明；只有 pi
	 * 拒了这次切换（`*` 标记 + 让用户按 `s`）或一个主题都没有时才给一句提示。
	 */
	private themeItems(): SettingsItem[] {
		const { themes, activeTheme: active, themeDraft: failed } = this.o.state;
		if (!themes.length)
			return [{ id: "theme", label: t("settings.category.theme"), value: "", description: t("settings.themeEmpty") }];
		const selected = failed ?? active;
		return [{
			id: "theme",
			label: t("settings.category.theme"),
			value: selected ?? "",
			...(failed === undefined ? {} : { description: t("settings.themePendingDescription", { name: failed }), dirty: true }),
		}];
	}

	private selected(text: string, width: number, selected: boolean, focused: boolean): string {
		const { theme } = this.o;
		const line = fit(`${selected ? "›" : " "} ${text}`, width);
		if (!selected) return theme.fg("text", line);
		return focused ? theme.bg("selectedBg", theme.fg("accent", line)) : theme.fg("accent", line);
	}

	/** Lay out the complete box immediately, including draft and persistence status. */
	render(width: number, height: number): string[] {
		const { state, theme } = this.o;
		// 每次重绘都重记一遍可点的格子（下面边画边填），鼠标命中和这一刻的画面严格对齐。
		this.clickables = [];
		if (width < 16 || height < 7) {
			return Array.from({ length: Math.max(0, height) }, (_, i) => fit(i === 0 ? `${DIALOG_CLOSE_KEYS} ${t("hint.close")}` : i === 1 ? t("settings.title") : "", width));
		}
		const auxiliaryBox = this.auxiliaryBox(width, height);
		const mainHeight = height - auxiliaryBox.length;
		const inner = width - 2;
		const wide = width >= 76;
		const sidebarWidth = wide ? Math.max(16, ...SETTINGS_CATEGORIES.map((c) => visibleWidth(t(`settings.category.${c}`)) + 4)) : 0;
		const contentWidth = wide ? inner - sidebarWidth - 3 : inner - 2;
		const areaHeight = mainHeight - 4; // borders + divider + buttons
		// 宽屏：正文按 " 分类栏 │ 内容 " 分两格，内容从这一列开始；窄屏只有内容。
		const contentCol = wide ? sidebarWidth + 3 : 0;
		const category = t(`settings.category.${state.category}`);
		let area: string[];
		if (wide) {
			const content = this.renderContent(contentWidth, areaHeight - 1, 1, { from: contentCol, to: inner });
			const categoryStart = clamp(SETTINGS_CATEGORIES.indexOf(state.category) - (areaHeight - 2), 0, SETTINGS_CATEGORIES.length - 1);
			area = Array.from({ length: areaHeight }, (_, i) => {
				const cat = SETTINGS_CATEGORIES[i - 1 + categoryStart];
				const left = i === 0 ? fit("", sidebarWidth) : cat ? this.selected(t(`settings.category.${cat}`), sidebarWidth, cat === state.category, state.region === "categories") : fit("", sidebarWidth);
				const right = i === 0 ? theme.bold(theme.fg("accent", category)) : content[i - 1] ?? "";
				// 侧栏这一格（含左边框和分隔线之间的空白）点的是这个分类；第 0 行是标题行，没有可点的东西。
				if (i > 0 && cat) this.clickables.push({ row: i, from: 0, to: contentCol, hit: { region: "categories", index: SETTINGS_CATEGORIES.indexOf(cat) } });
				return `${left} ${theme.fg("borderMuted", "│")} ${fit(right, contentWidth)}`;
			});
		} else {
			// 窄屏没有侧栏：标题行本身代表"分类"（点它把光标放到分类区域，j / k 接着翻分类）。
			const title = `${SETTINGS_CATEGORIES.indexOf(state.category) + 1}/4 ${category}`;
			area = [this.selected(title, inner, true, state.region === "categories")];
			this.clickables.push({ row: 0, from: 0, to: inner, hit: { region: "categories", index: SETTINGS_CATEGORIES.indexOf(state.category) } });
			area.push(...this.renderContent(contentWidth, areaHeight - area.length, area.length, { from: 0, to: inner }).map((line) => ` ${line}`));
		}
		// 按钮标签就写着它的直连键（任意区域都能按），重试只在失败时出现在表里。
		const buttons = this.buttons();
		const selectedButton = this.buttonIndex();
		const renderButton = (i: number, text: string, width: number): string => {
			const selected = state.region === "buttons" && selectedButton === i;
			const disabled = state.saving || buttons[i]?.disabled;
			return disabled
				? theme.fg("dim", fit(`${selected ? "›" : " "} ${text}`, width))
				: this.selected(text, width, selected, state.region === "buttons");
		};
		const labels = buttons.map((button) => `${button.key} ${button.label}`);
		const close = labels.map((label, i) => renderButton(i, `[ ${label} ]`, visibleWidth(label) + 6)).join(" ");
		// 按钮行的可点区间（每个按钮 `[ q Close ]` 恰好是 label + 6 列，之间隔一格）：窄屏只画选中的那个。
		const buttonRow = areaHeight + 1;
		if (width < 76) {
			this.clickables.push({ row: buttonRow, from: 0, to: inner, hit: { region: "buttons", index: selectedButton } });
		} else {
			let col = 0;
			labels.forEach((label, i) => {
				const buttonWidth = visibleWidth(label) + 6;
				this.clickables.push({ row: buttonRow, from: col, to: col + buttonWidth, hit: { region: "buttons", index: i } });
				col += buttonWidth + 1;
			});
		}
		const main = frame([
			...area,
			FRAME_DIVIDER,
			fit(width < 76 ? renderButton(selectedButton, `[ ${labels[selectedButton]} ] ${selectedButton + 1}/${labels.length}`, inner) : close, inner),
		], {
			width,
			height: mainHeight,
			...dialogHeader(width, `${t("settings.title")}${settingsDirtyCount(state) ? ` · ${t("settings.unsaved", { count: settingsDirtyCount(state) })}` : ""}`),
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
			metaStyle: (s) => theme.fg("dim", s),
		});
		return [...main, ...auxiliaryBox];
	}

	/**
	 * 设置行：光标 / 滚动 / 值列对齐都在这里。`rowOffset` 是这些行在主对话框正文里的行偏移，
	 * `span` 是它们在正文里的列区间（宽屏只有右半格，窄屏整行）；画每一行的同时把它是哪一条设置
	 * 记进 `clickables` —— 鼠标命中和画面共用这一份映射。
	 */
	private renderContent(width: number, height: number, rowOffset: number, span: { from: number; to: number }): string[] {
		if (height <= 0) return [];
		const { theme, state } = this.o;
		const items = this.items().map((item) => ({ ...item, label: `${item.dirty ? "* " : ""}${item.label}` }));
		const pos = this.position();
		pos.cursor = clamp(pos.cursor, 0, Math.max(0, items.length - 1));
		if (!items[pos.cursor]) return [fit(t("settings.noBindings"), width)];
		const rowHeight = width < 50 && height >= 2 ? 2 : 1;
		const capacity = Math.max(1, Math.floor(height / rowHeight));
		pos.scroll = clamp(pos.scroll, Math.max(0, pos.cursor - capacity + 1), pos.cursor);
		pos.scroll = Math.min(pos.scroll, Math.max(0, items.length - capacity));
		// 值列整页共用一列宽度，值在列里左对齐：逐行按自己的值取宽会让每行的值起点都不一样
		// （英文的值普遍比中文长，看起来就左右飘），共用一列后所有值对齐成一列，中文那边宽度不变。
		const valueWidth = Math.min(Math.max(12, ...items.map((item) => visibleWidth(item.value))), Math.floor(width / 2));
		const lines: string[] = [];
		for (let i = pos.scroll; i < Math.min(items.length, pos.scroll + capacity); i++) {
			const row = items[i]!;
			const isSelected = i === pos.cursor;
			// 一条设置占 rowHeight 行（窄屏时值是换行显示的），这几行都算命中这一条。
			for (let line = 0; line < rowHeight; line++) {
				this.clickables.push({ row: rowOffset + (i - pos.scroll) * rowHeight + line, from: span.from, to: span.to, hit: { region: "list", index: i } });
			}
			if (rowHeight === 2) {
				lines.push(this.selected(row.label, width, isSelected, state.region === "list"));
				lines.push(theme.fg("muted", fit(`  ${row.value}`, width)));
			} else if (!visibleWidth(row.value)) {
				// 没有值的行（主题页一个主题都没有时）：文字占满整行，不给 value 留空位。
				lines.push(this.selected(row.label, width, isSelected, state.region === "list"));
			} else {
				lines.push(this.selected(`${fit(row.label, Math.max(0, width - valueWidth - 4))}  ${fit(row.value, valueWidth)}`, width, isSelected, state.region === "list"));
			}
		}
		while (lines.length < height) lines.push("");
		return lines;
	}

	private feedback(): string[] {
		const { state, theme } = this.o;
		const messages: string[] = [];
		if (state.loading || state.saving) messages.push(theme.fg("muted", t(state.loading ? "settings.loading" : "settings.saving")));
		if (state.error) messages.push(theme.fg("error", state.error));
		if (state.notice) messages.push(theme.fg("muted", state.notice));
		return messages;
	}

	/** 操作结果和当前项说明共用一个底部框，中间以横线分隔，整体可用 PgUp/PgDn 滚动。 */
	private auxiliaryBox(width: number, height: number): string[] {
		const { theme, state } = this.o;
		const feedback = this.feedback();
		const pos = this.position();
		// 新的操作结果必须从头展示，不能被上一次说明框的滚动位置藏住。
		const feedbackKey = feedback.length ? `${state.category}/${state.keyScope}/${pos.cursor}/${feedback.join("\n")}` : "";
		if (feedbackKey !== this.lastFeedback) pos.detailScroll = 0;
		this.lastFeedback = feedbackKey;
		// 极矮屏优先保留操作结果和至少 6 行主框，放不下额外边框时退化为一行。
		if (height < 9) return feedback.length ? [fit(` ${feedback[0]}`, width)] : [];
		const items = this.items();
		const cursor = clamp(pos.cursor, 0, Math.max(0, items.length - 1));
		const item = items[cursor];
		const inner = width - 2;
		// 说明框只画说明本身：所属的条目就在上面的列表里（光标那行），把名字和值再抄一遍是冗余。
		const detail = height >= 11 && item?.description
			? wrapTextWithAnsi(item.description, Math.max(1, inner - 2)).map((line) => theme.fg("muted", line))
			: [];
		const messages = feedback.flatMap((text) => wrapTextWithAnsi(text, Math.max(1, inner - 2)));
		const content = [...messages, ...(messages.length && detail.length ? [FRAME_DIVIDER] : []), ...detail];
		if (!content.length) return [];
		const bodyHeight = Math.max(1, Math.min(content.length, Math.floor(height / 2) - 2, height - 8, 6));
		pos.detailScroll = clamp(pos.detailScroll, 0, Math.max(0, content.length - bodyHeight));
		const body = content.slice(pos.detailScroll, pos.detailScroll + bodyHeight).map((line) => line === FRAME_DIVIDER ? line : fit(` ${line}`, inner));
		const scroll = `${pos.detailScroll > 0 ? "↑ " : ""}${pos.detailScroll + bodyHeight < content.length ? "↓ PgDn" : ""}`.trim();
		const meta = [detail.length && items.length > 1 ? `${cursor + 1}/${items.length}` : "", scroll].filter(Boolean).join("  ");
		return frame(body, {
			width,
			height: body.length + 2,
			title: "",
			...(meta ? { meta } : {}),
			border: (s) => theme.fg("borderMuted", s),
			titleStyle: (s) => theme.fg("muted", s),
			metaStyle: (s) => theme.fg("dim", s),
		});
	}

	overlay(lines: string[], termW: number): string[] {
		const width = Math.max(0, Math.min(termW, termW - (termW >= 24 ? 4 : 0), 112));
		const height = Math.max(0, Math.min(lines.length, lines.length - (lines.length >= 9 ? 2 : 0), 30));
		const full = this.render(width, height);
		// 记下这次画出来的位置：鼠标的点按（hitAt / wheel）只认它，画哪儿就点哪儿。
		this.boxRect = centeredRect(termW, lines.length, width, full.length);
		return overlayCentered(lines, full, width, termW, (s) => this.o.theme.fg("dim", s), this.boxRect.top);
	}
}
