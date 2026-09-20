/**
 * Tree actions — side effects triggered from the tree pane.
 *
 *   restore -> ctx.navigateTree(entryId, { summarize, customInstructions })
 *              after the user picks: No summary | Summarize | Summarize with custom prompt
 *   copy    -> copyToClipboard(entry text)
 *   label   -> pi.setLabel(entryId, label)
 *
 * TODO: implement each action.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
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

export async function copyNodeText(_ctx: ExtensionCommandContext, _row: TreeRow): Promise<void> {
	// TODO
}

export async function labelNode(_ctx: ExtensionCommandContext, _row: TreeRow, _label: string | undefined): Promise<void> {
	// TODO
}
