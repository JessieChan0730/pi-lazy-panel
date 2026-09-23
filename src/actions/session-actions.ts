/**
 * Session actions — side effects triggered from the sessions pane.
 *
 * Each function wraps the equivalent pi command / API:
 *   resume  -> ctx.switchSession                                  (done)
 *   delete  -> remove the .jsonl (prefer `trash` CLI like pi does) (done)
 *   rename  -> pi.setSessionName / SessionManager.appendSessionInfo (done)
 *   copy    -> copyToClipboard (the Session Info dialog's `y`)     (done)
 *   new     -> ctx.newSession (+ session_info for /name)           (done)
 *   fork    -> ctx.fork(entryId, { position: "before" })          (done)
 *   clone   -> ctx.fork(leafId, { position: "at" })               (done)
 *   copy-reply -> copyToClipboard(last assistant reply) (`Y`)      (done)
 *   export  -> /export (HTML | JSONL)
 *   import  -> /import (JSONL)
 *   share   -> /share (private GitHub Gist)
 *
 * Destructive / branching actions (delete, fork, clone) must be confirmed by the
 * caller first (see ../ui/widgets/confirm-dialog.ts). These functions do not prompt.
 *
 * TODO: implement the remaining actions (export / import / share).
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
import { loadLastReply } from "../data/content.ts";
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

/** The slice `newSession` needs. */
export type NewSessionContext = Pick<ExtensionCommandContext, "newSession">;

/**
 * Start a fresh session (what `/new` does), naming it when `name` is non-empty.
 *
 * 名字非空时通过 `setup` 往新会话追加一条 session_info（对应 /name 的 `[name]` 参数），
 * 空名字就不设置。pi 建新会话后会切过去、收掉旧扩展，所以调用方走 `enter()` 关面板。
 * `setup` 里抛异常会被 pi 的包装当成致命错误直接退出进程（同 fork），所以它只做一次追加。
 */
export async function newSession(ctx: NewSessionContext, name: string): Promise<EnterOutcome> {
	const value = name.trim();
	const options = value ? { setup: async (sm: SessionManager) => void sm.appendSessionInfo(value) } : {};
	const result = await ctx.newSession(options);
	if (result.cancelled) throw new Error("new session cancelled by pi or an extension");
	return "switched";
}

/** The slice fork / clone need: current session (for isCurrentSession), fork, and switchSession for other files. */
export type ForkContext = Pick<ExtensionCommandContext, "sessionManager" | "fork" | "switchSession">;

/**
 * Fork the session before the user message `entryId`, opening the fork (what `/fork` does).
 *
 * pi 自己给扩展的 fork 包装会把那条 user 消息填回新会话的编辑器（`selectedText`），这里不用管。
 * `ctx.fork` 只能 fork 当前打开的会话，所以光标会话不是当前会话时先 `switchSession`，再在新 ctx
 * 上 fork（和 `restoreNode` 同一个做法）。调用方必须先经确认框确认，这里不弹窗。
 *
 * Throws (before pi is touched) when pi's fork would refuse; see `checkForkable`.
 */
export async function forkSession(ctx: ForkContext, sessionFile: string, entryId: string): Promise<EnterOutcome> {
	return forkAt(ctx, sessionFile, entryId, "before");
}

/** Clone the active branch to a new file (what `/clone` does): fork the leaf with position "at". */
export async function cloneSession(ctx: ForkContext, sessionFile: string): Promise<EnterOutcome> {
	const manager = isCurrentSession(ctx, sessionFile) ? ctx.sessionManager : openSessionFile(sessionFile);
	const leafId = manager.getLeafId();
	if (!leafId) throw new Error("nothing to clone yet");
	return forkAt(ctx, sessionFile, leafId, "at");
}

/** Shared body of fork / clone: refuse what pi would throw on, then fork here or after switching. */
async function forkAt(ctx: ForkContext, sessionFile: string, entryId: string, position: "before" | "at"): Promise<EnterOutcome> {
	const current = isCurrentSession(ctx, sessionFile);
	checkForkable(current ? ctx.sessionManager : openSessionFile(sessionFile), sessionFile, entryId, position);
	const label = position === "at" ? "clone" : "fork";
	const fork = async (c: Pick<ExtensionCommandContext, "fork">): Promise<void> => {
		const result = await c.fork(entryId, { position });
		if (result.cancelled) throw new Error(`${label} cancelled by pi or an extension`);
	};
	if (current) {
		await fork(ctx);
		return "switched";
	}
	// 其他会话：先切过去，切换后旧 ctx 失效，只能在新 ctx 上 fork；这时面板已被 pi 收掉，失败只能 notify。
	await resumeSession(ctx, sessionFile, {
		withSession: async (next) => {
			try {
				await fork(next);
			} catch (err) {
				next.ui.notify(`${label} failed: ${(err as Error).message}`, "error");
			}
		},
	});
	return "switched";
}

/**
 * Refuse, with a readable error, every case pi's fork throws on.
 *
 * 必须在调用 `ctx.fork` 之前拦下：pi 给扩展的 fork 包装（interactive-mode 的 commandContextActions）
 * 把 fork 里的任何异常都交给 `handleFatalRuntimeError`，它会直接 `process.exit(1)` 把整个 pi 退掉。
 * pi 会抛的情况：条目不存在、position "before" 但不是 user 消息、会话文件还没落盘；另外 fork
 * 出来的会话按文件里记的 cwd 重建，那个目录已经被删了就不让它去试。
 */
function checkForkable(manager: Pick<SessionManager, "getEntry">, sessionFile: string, entryId: string, position: "before" | "at"): void {
	if (!existsSync(sessionFile)) throw new Error(`session file not found: ${sessionFile}`);
	const entry = manager.getEntry(entryId);
	if (!entry) throw new Error(`entry ${entryId} not found in session`);
	if (position === "before" && (entry.type !== "message" || entry.message.role !== "user")) {
		throw new Error("can only fork before a user message");
	}
	// 读文件里记的 cwd（当前会话在内存里可能带着 resume 时的 cwd 覆盖，pi fork 时不会用它）。
	const cwd = SessionManager.open(sessionFile).getCwd();
	if (cwd && !existsSync(cwd)) throw new Error(`the session's folder no longer exists: ${cwd}`);
}

/**
 * Copy the last assistant reply of `sessionFile` to the clipboard (what `/copy` does).
 * Returns `false` when the branch has no assistant reply yet.
 */
export async function copyLastReply(sessionFile: string): Promise<boolean> {
	const text = await loadLastReply(sessionFile);
	if (!text) return false;
	await copyToClipboard(text);
	return true;
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
