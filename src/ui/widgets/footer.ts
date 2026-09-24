/**
 * Footer bar.
 *
 * Single line at the bottom of the panel:
 *   │ NORMAL │ / Search   ? Help   l Focus   Enter Resume   d Delete   q Quit
 *
 * Shows the current mode and the most relevant bindings for the focused pane.
 * Hints are derived from the resolved keymap, so custom bindings show up here.
 * When search mode is active the panel renders the search bar instead; while a
 * dialog owns the keyboard (label / restore mode) the panel passes the
 * dialog's own hints via `hints`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FOOTER_HINTS } from "../../config/keymap.ts";
import { labelsForFocus } from "../../config/keys.ts";
import { t } from "../../i18n/index.ts";
import type { ActionId, KeyHint, Keymap, ListScope, PaneId, PanelMode } from "../../types.ts";
import { fit } from "../frame.ts";

export interface FooterProps {
	mode: PanelMode;
	focus: PaneId;
	keymap: Keymap;
	theme: Theme;
	/** Current list scope; the hint for the scope already active is hidden ("A All" while on Current). */
	scope?: ListScope;
	/** Optional status text (e.g. "loading…" or an error). */
	status?: string;
	/** Replace the keymap-derived hints, e.g. with a dialog's keys while it is open. */
	hints?: KeyHint[];
	/** Extension version, shown muted at the far right (e.g. "0.1.0" → "v0.1.0"). */
	version?: string;
}

/** Scope actions are one-way, so only the one that would change something is worth a hint. */
const SCOPE_ACTION_OF: Record<ListScope, ActionId> = {
	"current-folder": "scope-current",
	all: "scope-all",
};

/** Actions with a short footer wording (under `footer.` in the locale files); others fall back to the action id. */
const HAS_SHORT: ReadonlySet<ActionId> = new Set<ActionId>([
	"search",
	"help",
	"focus-next",
	"scope-current",
	"scope-all",
	"quit",
	"session-resume",
	"session-delete",
	"session-rename",
	"session-new",
	"session-fork",
	"session-clone",
	"session-copy-last-reply",
	"session-export",
	"session-import",
	"session-share",
	"session-sort",
	"session-info",
	"session-compact",
	"tree-restore",
	"tree-open",
	"tree-fold",
	"tree-label",
	"tree-copy",
	"go-top",
	"go-bottom",
	"changelog",
]);

/** Short footer wording of `action` (localised), falling back to the action id. */
function footerLabel(action: ActionId): string {
	return HAS_SHORT.has(action) ? t(`footer.${action}`) : action;
}

export function renderFooter(p: FooterProps, width: number): string[] {
	const { theme } = p;
	const mode = theme.bold(theme.bg("selectedBg", ` ${t(`mode.${p.mode}`)} `));
	const status = p.status ? `  ${theme.fg("warning", p.status)}` : "";
	// 右下角的版本号（muted 弱化显示），先给它预留位置，避免按键提示占满后把它挤没。
	const version = p.version ? theme.fg("muted", `v${p.version}`) : "";
	const versionBudget = version ? visibleWidth(version) + 2 : 0;
	const budget = width - visibleWidth(mode) - visibleWidth(status) - versionBudget - 1;

	// 只显示放得下的提示，避免窄终端里被截断成半个词。
	const parts: string[] = [];
	let used = 0;
	for (const [key, text] of p.hints ?? keymapHints(p)) {
		const part = `${theme.bold(theme.fg("accent", key))} ${theme.fg("muted", text)}`;
		const w = visibleWidth(part) + (parts.length ? 3 : 0);
		if (used + w > budget) break;
		parts.push(part);
		used += w;
	}
	const left = `${mode} ${parts.join("   ")}${status}`;
	if (!version) return [fit(left, width)];
	// 版本号靠右：中间用空格撑开，整体再 fit 到宽度（放不下时优先保留左侧提示，版本被截断）。
	const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(version));
	return [fit(`${left}${" ".repeat(gap)}${version}`, width)];
}

/** Hints of the focused pane from the resolved keymap, in FOOTER_HINTS order. */
function keymapHints(p: FooterProps): KeyHint[] {
	// 当前已经是 Current 就不提示 C Current，只提示 A All；反之亦然。
	const activeScopeAction = p.scope ? SCOPE_ACTION_OF[p.scope] : undefined;
	const out: KeyHint[] = [];
	for (const action of FOOTER_HINTS[p.focus]) {
		if (action === activeScopeAction) continue;
		const labels = labelsForFocus(p.keymap, p.focus, action);
		if (labels.length === 0) continue;
		out.push([labels[0]!, footerLabel(action)]);
	}
	return out;
}
