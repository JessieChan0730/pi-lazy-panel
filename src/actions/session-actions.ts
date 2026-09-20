/**
 * Session actions — side effects triggered from the sessions pane.
 *
 * Each function wraps the equivalent pi command / API:
 *   resume  -> ctx.switchSession
 *   delete  -> remove the .jsonl (prefer `trash` CLI like pi does)
 *   rename  -> session info entry (/name)
 *   fork    -> ctx.fork(entryId, { position: "before" })
 *   clone   -> ctx.fork(entryId, { position: "at" })
 *   export  -> /export (HTML | JSONL)
 *   import  -> /import (JSONL)
 *   share   -> /share (private GitHub Gist)
 *   copy    -> copyToClipboard(last assistant reply)
 *   new     -> ctx.newSession + pi.setSessionName
 *
 * Destructive actions (delete, fork) must be confirmed by the caller first
 * (see ../ui/widgets/confirm-dialog.ts). These functions do not prompt.
 *
 * TODO: implement each action.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SessionRow } from "../types.ts";

export async function resumeSession(_ctx: ExtensionCommandContext, _row: SessionRow): Promise<void> {
	// TODO
}

export async function deleteSessions(_ctx: ExtensionCommandContext, _rows: SessionRow[]): Promise<void> {
	// TODO
}

export async function renameSession(_ctx: ExtensionCommandContext, _row: SessionRow, _name: string): Promise<void> {
	// TODO
}

export async function forkSession(_ctx: ExtensionCommandContext, _row: SessionRow): Promise<void> {
	// TODO
}

export async function cloneSession(_ctx: ExtensionCommandContext, _row: SessionRow): Promise<void> {
	// TODO
}

export async function exportSession(
	_ctx: ExtensionCommandContext,
	_row: SessionRow,
	_targetDir: string,
	_format: "html" | "jsonl",
): Promise<void> {
	// TODO
}

export async function importSession(_ctx: ExtensionCommandContext, _sourcePath: string): Promise<void> {
	// TODO
}

export async function shareSession(_ctx: ExtensionCommandContext, _row: SessionRow): Promise<string | undefined> {
	// TODO: returns shareable URL
	return undefined;
}

export async function copyLastReply(_ctx: ExtensionCommandContext, _row: SessionRow): Promise<void> {
	// TODO
}

export async function newSession(_ctx: ExtensionCommandContext, _name: string): Promise<void> {
	// TODO
}
