/**
 * Tree actions — side effects triggered from the tree pane.
 *
 *   restore -> ctx.navigateTree(entryId, { summarize, customInstructions })
 *              after the user picks: No summary | Summarize | Summarize with custom prompt (TODO)
 *   copy    -> copyToClipboard(full entry text)            (/tree ctrl+x)
 *   label   -> pi.setLabel / SessionManager.appendLabelChange (/tree shift+T)
 *
 * No dialogs here: the caller collects input / confirmation first.
 */

import {
	copyToClipboard,
	type ExtensionAPI,
	type ExtensionCommandContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { loadNodeText } from "../data/tree.ts";
import type { TreeRow } from "../types.ts";

export type RestoreSummaryMode = "none" | "summarize" | "summarize-custom";

export interface RestoreOptions {
	mode: RestoreSummaryMode;
	customInstructions?: string;
}

export async function restoreToNode(
	_ctx: ExtensionCommandContext,
	_row: TreeRow,
	_options: RestoreOptions,
): Promise<void> {
	// TODO
}

/**
 * Copy the full text of a tree node to the system clipboard.
 * Resolves to `false` when the entry has no text to copy (like /tree's
 * "Selected entry has no text to copy").
 */
export async function copyNodeText(sessionFile: string, entryId: string): Promise<boolean> {
	const text = loadNodeText(sessionFile, entryId);
	if (!text) return false;
	await copyToClipboard(text);
	return true;
}

/**
 * Set (or clear with `undefined` / "") a label on a tree node.
 *
 * 面板操作的可能是任意历史会话文件：如果就是 pi 当前打开的会话，走 `pi.setLabel`
 * 让 pi 内存里的 SessionManager 同步；否则单独打开该文件追加 label 条目
 * （SessionManager.open 会持久化到 .jsonl）。
 */
export async function labelNode(
	pi: Pick<ExtensionAPI, "setLabel">,
	ctx: Pick<ExtensionCommandContext, "sessionManager">,
	sessionFile: string,
	entryId: string,
	label: string | undefined,
): Promise<void> {
	const value = label?.trim() || undefined;
	if (ctx.sessionManager.getSessionFile() === sessionFile) {
		pi.setLabel(entryId, value);
		return;
	}
	SessionManager.open(sessionFile).appendLabelChange(entryId, value);
}
