/**
 * Session actions — side effects triggered from the sessions pane.
 *
 * Each function wraps the equivalent pi command / API:
 *   resume  -> ctx.switchSession                                  (done)
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
 * TODO: implement the remaining actions.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import type { EnterOutcome, SessionRow } from "../types.ts";

/** The slice of the command context `resumeSession` needs (tests pass plain objects). */
export type ResumeContext = Pick<ExtensionCommandContext, "sessionManager" | "switchSession">;

/** Post-switch work, run by pi against the replacement session's own context. */
export type SwitchOptions = NonNullable<Parameters<ExtensionCommandContext["switchSession"]>[1]>;

/** Is `sessionFile` the session pi currently has open? (Same rule as labelling: compare resolved paths.) */
export function isCurrentSession(ctx: Pick<ExtensionCommandContext, "sessionManager">, sessionFile: string): boolean {
	const current = ctx.sessionManager.getSessionFile();
	return current !== undefined && resolve(current) === resolve(sessionFile);
}

/**
 * Open a history session file for reading.
 * Throws a readable error when the file is gone or unparsable, so callers can
 * report it before pi starts tearing the current session down.
 */
export function openSessionFile(sessionFile: string): SessionManager {
	if (!existsSync(sessionFile)) throw new Error(`session file not found: ${sessionFile}`);
	return SessionManager.open(sessionFile);
}

/**
 * Switch pi to `sessionFile` (what `/resume` does when a session is picked).
 *
 * 目标就是当前会话时什么都不做（返回 `unchanged`）；否则先确认文件能打开，再交给
 * `ctx.switchSession`。pi 自己会先中断正在输出的回复再切换（和内置 /resume 一样，不额外确认）。
 * 切换成功后传入的 `ctx` 就失效了，后续要在新会话里做的事只能放进 `options.withSession`。
 *
 * Throws when the file cannot be opened or pi / another extension cancelled the switch.
 */
export async function resumeSession(ctx: ResumeContext, sessionFile: string, options?: SwitchOptions): Promise<EnterOutcome> {
	if (isCurrentSession(ctx, sessionFile)) return "unchanged";
	openSessionFile(sessionFile);
	const result = await ctx.switchSession(sessionFile, options);
	if (result.cancelled) throw new Error("switch cancelled by pi or an extension");
	return "switched";
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
