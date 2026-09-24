/**
 * Session Info dialog (`i` in the sessions pane): what `/session` prints, in a
 * box centered over the panel.
 *
 *   ┌─ Session Info ─────────────────── FilmRecall ─┐
 *   │ Name      FilmRecall                           │
 *   │ Model     claude-opus-4                        │
 *   │ Messages  128                                  │
 *   │ Tokens    84.2k                                │
 *   │ Cost      $1.42                                │
 *   │ Created   Sep 20 22:18                         │
 *   │ Updated   Sep 20 22:21                         │
 *   │ Path      ~/.pi/agent/sessions/--home-cheng-code--/  │
 *   │           2026-09-20T14-18-00-000Z_0199abcd.jsonl    │
 *   │ ID        0199…                                      │
 *   └──────────────────────────────────────────────────────┘
 *    INFO │ y copy   Esc close                            <- footer while open
 *
 * Read-only: `y` hands the whole text (one `Label  value` line per row, the
 * full path) to `onCopy`, Esc / q close. Every other key is swallowed. A value
 * wider than the box (the path) wraps onto continuation lines, never gets cut.
 * Like the other dialogs it only draws; the panel loads the data
 * (data/content.ts `loadSessionInfo`) and does the copying through the actions
 * layer.
 *
 * 会话信息弹窗：只管画和 y / Esc 两个键；过长的值（路径）换行显示、不截断；
 * 数据由面板通过 DataSource 加载，复制走 actions 层。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { matchesKeyId } from "../../config/keys.ts";
import { t } from "../../i18n/index.ts";
import type { KeyHint, SessionInfo } from "../../types.ts";
import { formatCost, formatDateTime, formatTokens, shortenPath } from "../../utils/format.ts";
import { dialogWidth, frame, metaBudget, overlayCentered } from "../frame.ts";

/** Title on the top border (localised). */
export function sessionInfoTitle(): string {
	return t("dialog.sessionInfoTitle");
}

/** Footer hints while the dialog is open. */
export function sessionInfoHints(): KeyHint[] {
	return [
		["y", t("hint.copy")],
		["Esc", t("hint.close")],
	];
}

/** Width of the label column ("Messages" is the longest label). */
const LABEL_WIDTH = 9;

export interface SessionInfoDialogSpec {
	info: SessionInfo;
	/** `y`: receives the dialog's text (see `sessionInfoText`). */
	onCopy: (text: string) => void;
	onClose: () => void;
}

export interface SessionInfoDialogOptions {
	theme: Theme;
}

/**
 * The rows of the dialog as `[label, value]` pairs, in display order. Missing
 * name / model show as "(none)" / "(unknown)"; the path is shown shortened
 * (`~/…`) and copied in full.
 */
export function sessionInfoRows(info: SessionInfo, fullPath = false): Array<[label: string, value: string]> {
	return [
		[t("info.name"), info.name ?? t("info.none")],
		[t("info.model"), info.model ?? t("info.unknown")],
		[t("info.messages"), String(info.messages)],
		[t("info.tokens"), formatTokens(info.tokens)],
		[t("info.cost"), formatCost(info.cost)],
		[t("info.created"), formatDateTime(info.createdAt) || "-"],
		[t("info.updated"), formatDateTime(info.updatedAt) || "-"],
		[t("info.path"), fullPath ? info.path : shortenPath(info.path)],
		[t("info.id"), info.id],
	];
}

/** Pad `text` with spaces until it is at least `width` visible columns (wide chars count as two). */
function padColumns(text: string, width: number): string {
	const extra = width - visibleWidth(text);
	return extra > 0 ? text + " ".repeat(extra) : text;
}

/** What `y` copies: one `Label     value` line per row, with the full path. */
export function sessionInfoText(info: SessionInfo): string {
	return sessionInfoRows(info, true)
		.map(([label, value]) => `${padColumns(label, LABEL_WIDTH)} ${value}`)
		.join("\n");
}

/**
 * Split `value` into pieces of at most `width` visible columns. Paths have no
 * spaces to break at, so this cuts by column (wide characters count as two).
 */
export function wrapValue(value: string, width: number): string[] {
	if (!value) return [""];
	const out: string[] = [];
	let rest = value;
	while (visibleWidth(rest) > width) {
		const head = sliceByColumn(rest, 0, width);
		out.push(head);
		rest = rest.slice(head.length);
	}
	out.push(rest);
	return out;
}

export class SessionInfoDialog {
	private spec: SessionInfoDialogSpec | undefined;

	constructor(private readonly o: SessionInfoDialogOptions) {}

	/** True between `open` and `close`. */
	get isOpen(): boolean {
		return this.spec !== undefined;
	}

	/** Footer hints while open (empty when closed). */
	get hints(): KeyHint[] {
		return this.spec ? sessionInfoHints() : [];
	}

	open(spec: SessionInfoDialogSpec): void {
		this.spec = spec;
	}

	/** Drop the dialog without firing a callback. */
	close(): void {
		this.spec = undefined;
	}

	handleInput(data: string): void {
		const spec = this.spec;
		if (!spec) return;
		if (matchesKeyId(data, "escape") || matchesKeyId(data, "q")) {
			spec.onClose();
			return;
		}
		if (matchesKeyId(data, "y")) spec.onCopy(sessionInfoText(spec.info));
		// 其他按键一律吞掉，不能漏到下面的面板去。
	}

	/**
	 * Render the box itself, every line exactly `width` columns. A value too long
	 * for the box (the path, usually) continues on the next lines under the
	 * value column instead of being cut short — the dialog exists to show it.
	 *
	 * 值放不下时换行续在值那一列下面，不截断：路径这类信息截了就没意义了。
	 */
	render(width: number): string[] {
		const { theme } = this.o;
		const info = this.spec?.info;
		const rows = info ? sessionInfoRows(info) : [];
		const inner = width - 2;
		const valueWidth = Math.max(1, inner - LABEL_WIDTH - 3);
		const body: string[] = [];
		for (const [label, value] of rows) {
			const parts = wrapValue(value, valueWidth);
			parts.forEach((part, i) => {
				// 第一行带标签（muted、按可见列对齐），续行标签列留空。
				const head = i === 0 ? theme.fg("muted", padColumns(label, LABEL_WIDTH)) : " ".repeat(LABEL_WIDTH);
				body.push(` ${head} ${theme.fg("text", part)}`);
			});
		}
		const subject = info?.name ?? "";
		const meta = truncateToWidth(subject, metaBudget(width, sessionInfoTitle()) - 3, "…", false);
		return frame(body, {
			width,
			height: body.length + 2,
			title: sessionInfoTitle(),
			...(meta ? { meta } : {}),
			border: (s) => theme.fg("borderAccent", s),
			titleStyle: (s) => theme.bold(theme.fg("accent", s)),
			metaStyle: (s) => theme.fg("dim", s),
		});
	}

	/** Composite the box centered over the already-rendered panel `lines`. */
	overlay(lines: string[], termW: number): string[] {
		const width = dialogWidth(termW);
		return overlayCentered(lines, this.render(width), width, termW);
	}
}
