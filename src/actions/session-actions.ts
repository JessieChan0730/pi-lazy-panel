/**
 * Session actions — side effects triggered from the sessions pane.
 *
 * Each function wraps the equivalent pi command / API:
 *   resume  -> ctx.switchSession                                  (done)
 *   delete  -> remove the .jsonl (prefer `trash` CLI like pi does) (done)
 *   rename  -> pi.setSessionName / SessionManager.appendSessionInfo (done)
 *   copy    -> copyToClipboard (the Session Info dialog's `y`)     (done)
 *   fork    -> ctx.fork(entryId, { position: "before" })
 *   clone   -> ctx.fork(entryId, { position: "at" })
 *   export  -> /export (HTML | JSONL)
 *   import  -> /import (JSONL)
 *   share   -> /share (private GitHub Gist)
 *   new     -> ctx.newSession + pi.setSessionName
 *
 * Destructive actions (delete, fork) must be confirmed by the caller first
 * (see ../ui/widgets/confirm-dialog.ts). These functions do not prompt.
 *
 * TODO: implement the remaining actions.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
	copyToClipboard,
	type ExtensionAPI,
	type ExtensionCommandContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { DeleteMethod, EnterOutcome, SessionRow } from "../types.ts";

/** The slice of the command context `resumeSession` needs (tests pass plain objects). */
export type ResumeContext = Pick<ExtensionCommandContext, "sessionManager" | "switchSession">;

/** Post-switch work, run by pi against the replacement session's own context. */
export type SwitchOptions = NonNullable<Parameters<ExtensionCommandContext["switchSession"]>[1]>;

/** The slice of the command context the file-level actions (delete / rename) need. */
export type SessionContext = Pick<ExtensionCommandContext, "sessionManager">;

/** Is `sessionFile` the session pi currently has open? (Same rule as labelling: compare resolved paths.) */
export function isCurrentSession(ctx: SessionContext, sessionFile: string): boolean {
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

/** pi's wording when the cursor is on the session it currently has open. */
export const CURRENT_SESSION_DELETE_ERROR = "Cannot delete the currently active session";

export interface DeleteOptions {
	/** Command tried before falling back to `unlink` (default `trash`; tests pass a name that does not exist). */
	trashCommand?: string;
}

/**
 * Delete one session file (what `/resume`'s ctrl+d does once confirmed).
 *
 * 照搬 pi 内置 /resume 的做法：当前打开的会话拒绝删除；其他会话先试系统的 `trash` 命令
 * （能进回收站就进回收站），命令不存在或失败再 `unlink` 永久删除。返回用的是哪种方式，
 * 面板据此在 footer 里说明。调用方必须先经确认框确认，这里不弹窗。
 *
 * Throws when the file is the current session, does not exist, or neither
 * method could remove it (the unlink error, plus what `trash` said).
 */
export async function deleteSession(ctx: SessionContext, sessionFile: string, options: DeleteOptions = {}): Promise<DeleteMethod> {
	if (isCurrentSession(ctx, sessionFile)) throw new Error(CURRENT_SESSION_DELETE_ERROR);
	if (!existsSync(sessionFile)) throw new Error(`session file not found: ${sessionFile}`);
	// 文件名以 - 开头时要用 -- 隔开，否则会被 trash 当成选项。
	const trashArgs = sessionFile.startsWith("-") ? ["--", sessionFile] : [sessionFile];
	const trash = spawnSync(options.trashCommand ?? "trash", trashArgs, { encoding: "utf-8" });
	// trash 报告成功，或者文件已经不在了，都算进了回收站。
	if (trash.status === 0 || !existsSync(sessionFile)) return "trash";
	try {
		await unlink(sessionFile);
		return "unlink";
	} catch (err) {
		const hint = trashErrorHint(trash);
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(hint ? `${message} (${hint})` : message);
	}
}

/** First line of what `trash` complained about, for the error when `unlink` fails too. */
function trashErrorHint(result: ReturnType<typeof spawnSync>): string | undefined {
	const parts: string[] = [];
	if (result.error) parts.push(result.error.message);
	const stderr = String(result.stderr ?? "").trim();
	if (stderr) parts.push(stderr.split("\n")[0] ?? stderr);
	if (parts.length === 0) return undefined;
	return `trash: ${parts.join(" · ").slice(0, 200)}`;
}

/**
 * Set (or clear with "") the display name of a session (what `/name` does).
 *
 * 分流和打标签一致：目标是 pi 当前打开的会话就走 `pi.setSessionName`（pi 内存里的
 * SessionManager 同步更新、还会广播 session_info_changed）；其他历史会话单独打开文件
 * 追加一条 session_info 条目（pi 内置 /resume 的 rename 就是这么做的）。空名字清除名称：
 * pi 的 `getSessionName` 对空的 session_info 返回 undefined。
 *
 * Throws when the file does not exist.
 */
export async function renameSession(
	pi: Pick<ExtensionAPI, "setSessionName">,
	ctx: SessionContext,
	sessionFile: string,
	name: string,
): Promise<void> {
	const value = name.trim();
	if (isCurrentSession(ctx, sessionFile)) {
		pi.setSessionName(value);
		return;
	}
	openSessionFile(sessionFile).appendSessionInfo(value);
}

/** Copy arbitrary text to the system clipboard (the Session Info dialog's `y`). */
export async function copyText(text: string): Promise<void> {
	await copyToClipboard(text);
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
