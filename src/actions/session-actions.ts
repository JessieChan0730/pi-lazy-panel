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
 *   export  -> HTML: `pi --export <file> <out>`; JSONL: header + active branch (done)
 *   import  -> copy into the session dir + ctx.switchSession       (done)
 *   share   -> `pi --export` + `gh gist create --public=false`      (done)
 *
 * Destructive / branching / outbound actions (delete, fork, clone, share,
 * overwriting an export) must be confirmed by the caller first (see
 * ../ui/widgets/confirm-dialog.ts). These functions do not prompt.
 */

import { spawn, spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import {
	copyToClipboard,
	CURRENT_SESSION_VERSION,
	type ExtensionAPI,
	type ExtensionCommandContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { loadLastReply } from "../data/content.ts";
import type { DeleteMethod, EnterOutcome, ExportFormat, ExportTarget, ShareResult } from "../types.ts";
import { resolveUserPath, stripQuotes } from "../utils/paths.ts";

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

// ---------------------------------------------------------------------------
// export / import / share
// ---------------------------------------------------------------------------

/** How to run an external program: the executable plus the arguments that go before ours. */
export interface CommandSpec {
	command: string;
	args: string[];
}

/** Overrides for the programs export / share spawn (tests pass `node fake.js`). */
export interface ExternalCommands {
	/** pi itself, for `pi --export` (default: the running pi, see `runningPi`). */
	pi?: CommandSpec;
	/** The GitHub CLI (default `gh`). */
	gh?: CommandSpec;
}

/** `pi --export` renders a whole session to HTML; it normally takes about a second. */
const EXPORT_TIMEOUT_MS = 60_000;
/** `gh auth status` / `gh gist create` talk to GitHub. */
const GH_TIMEOUT_MS = 60_000;

/**
 * The pi that is running this extension, as a command.
 *
 * 扩展 API 只有 AgentSession 上的 exportToHtml（只能导出当前会话），包的 exports 也只开放了
 * 入口，所以 HTML 走 pi 自己公开的 CLI：`pi --export <file> <out>`（和 pi 对任意会话文件导出
 * 用的是同一个 exportFromFile）。不用 PATH 上的 `pi`：Windows 上那是 pi.cmd，不开 shell 起不来，
 * 版本也可能和正在运行的不同。npm 安装时 argv[1] 是 cli.js，用同一个 node 跑它；Bun 编译的单文件里
 * 可执行文件本身就是 pi，argv[1] 是磁盘上不存在的虚拟路径。
 */
export function runningPi(): CommandSpec {
	const script = process.argv[1];
	if (script && existsSync(script)) {
		// tsx 这类加载器参数要带上；--inspect 会和父进程抢调试端口，去掉。
		const execArgs = process.execArgv.filter((arg) => !arg.startsWith("--inspect"));
		return { command: process.execPath, args: [...execArgs, script] };
	}
	return { command: process.execPath, args: [] };
}

interface RunResult {
	code: number | null;
	stdout: string;
	stderr: string;
	/** Could not be started (e.g. ENOENT), or was killed after the timeout. */
	error?: Error;
}

/** Run a program to completion without a shell or a terminal (stdin closed, output captured). */
function runCommand(spec: CommandSpec, args: string[], timeoutMs: number): Promise<RunResult> {
	return new Promise((done) => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (result: RunResult): void => {
			if (settled) return;
			settled = true;
			done(result);
		};
		// stdin 必须关掉：子进程继承 pi 的终端会抢走按键。
		const child = spawn(spec.command, [...spec.args, ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: timeoutMs });
		child.stdout.on("data", (chunk) => (stdout += String(chunk)));
		child.stderr.on("data", (chunk) => (stderr += String(chunk)));
		child.on("error", (error) => finish({ code: null, stdout, stderr, error }));
		child.on("close", (code, signal) => {
			const error = code === null ? new Error(`timed out or killed (${signal ?? "no exit code"})`) : undefined;
			finish(error ? { code, stdout, stderr, error } : { code, stdout, stderr });
		});
	});
}

/** First non-empty line of a program's complaint, without colors. */
function firstLine(text: string): string {
	// 去掉 chalk 的颜色码（子进程不是终端时一般不会有，保险起见）。
	const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
	return plain.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

/** pi's default export file name: `pi-session-<file>.html`, or a timestamped `session-….jsonl` (both in the cwd). */
export function defaultExportName(sessionFile: string, format: ExportFormat, now = new Date()): string {
	if (format === "html") return `pi-session-${basename(sessionFile, ".jsonl")}.html`;
	return `session-${now.toISOString().replace(/[:.]/g, "-")}.jsonl`;
}

/**
 * Where `e` writes, from what the user typed: blank = pi's default name in the
 * cwd; a directory (existing, or typed with a trailing separator) gets the
 * default name inside it; anything else is the file itself. `~` and relative
 * paths work on every platform (see ../utils/paths.ts).
 */
export function exportTarget(cwd: string, sessionFile: string, format: ExportFormat, input: string): ExportTarget {
	const typed = stripQuotes(input.trim()).trim();
	let path = resolveUserPath(cwd, input);
	if (!path) path = join(cwd, defaultExportName(sessionFile, format));
	else if (/[\\/]$/.test(typed) || isDirectory(path)) path = join(path, defaultExportName(sessionFile, format));
	return { path, exists: existsSync(path) };
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** The slice export needs: the current session's in-memory manager (its leaf may not be on disk yet). */
export type ExportContext = Pick<ExtensionCommandContext, "sessionManager">;

/**
 * Export `sessionFile` to `outputPath` (what `/export` does), for any session, not only the open one.
 *
 * - `html`：交给 `pi --export`（整棵树都在里面，默认显示活动分支；和 CLI 一样不带系统提示词 / 工具
 *   定义，用 pi 的默认主题）。
 * - `jsonl`：照搬 pi 的 exportSessionToJsonl：新的 header + 活动分支上的条目，parentId 重新串成一条链。
 *   当前会话用 pi 内存里的 manager（跳转后还没落盘的叶子也算），其他会话读文件。
 *
 * 目标文件已存在时直接覆盖，调用方负责先问；拒绝把会话文件自己当成输出（JSONL 只留一条分支，会丢数据）。
 * Returns the path written.
 */
export async function exportSession(
	ctx: ExportContext,
	sessionFile: string,
	format: ExportFormat,
	outputPath: string,
	commands: ExternalCommands = {},
): Promise<string> {
	if (!existsSync(sessionFile)) throw new Error(`session file not found: ${sessionFile}`);
	if (resolve(outputPath) === resolve(sessionFile)) throw new Error("refusing to overwrite the session file itself");
	if (isDirectory(outputPath)) throw new Error(`is a directory: ${outputPath}`);
	mkdirSync(dirname(outputPath), { recursive: true });
	if (format === "jsonl") {
		writeJsonlExport(isCurrentSession(ctx, sessionFile) ? ctx.sessionManager : openSessionFile(sessionFile), outputPath);
	} else {
		await exportHtmlFile(sessionFile, outputPath, commands.pi ?? runningPi());
	}
	return outputPath;
}

/** pi's exportSessionToJsonl, line for line: a fresh header, then the active branch re-chained. */
function writeJsonlExport(manager: Pick<SessionManager, "getSessionId" | "getCwd" | "getBranch">, outputPath: string): void {
	const header = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: manager.getSessionId(),
		timestamp: new Date().toISOString(),
		cwd: manager.getCwd(),
	};
	const lines = [JSON.stringify(header)];
	let parentId: string | null = null;
	for (const entry of manager.getBranch()) {
		lines.push(JSON.stringify({ ...entry, parentId }));
		parentId = entry.id;
	}
	writeFileSync(outputPath, `${lines.join("\n")}\n`);
}

/** `pi --export <file> <out>`; throws with what pi printed when it fails. */
async function exportHtmlFile(sessionFile: string, outputPath: string, pi: CommandSpec): Promise<void> {
	const result = await runCommand(pi, ["--export", sessionFile, outputPath], EXPORT_TIMEOUT_MS);
	if (result.error) throw new Error(`cannot run pi --export: ${result.error.message}`);
	if (result.code !== 0) {
		const reason = firstLine(result.stderr).replace(/^Error:\s*/, "");
		throw new Error(reason || `pi --export exited with code ${result.code}`);
	}
	if (!existsSync(outputPath)) throw new Error("pi --export did not write the file");
}

/** The slice import needs: where sessions live, the cwd relative paths are resolved against, and switchSession. */
export type ImportContext = Pick<ExtensionCommandContext, "sessionManager" | "switchSession" | "cwd">;

/**
 * Import a session JSONL and switch to it (what `/import` does).
 *
 * 扩展 ctx 上没有 pi 的 `importFromJsonl`，但它做的事很简单，这里照搬：把文件复制进当前会话目录
 * （重名就加 -1、-2 后缀，文件本来就在会话目录里则不复制），再切过去。切换交给 `resumeSession`：
 * 先 `SessionManager.open` 校验（不是 pi 会话文件会抛错，必须在 `ctx.switchSession` 之前拦下，
 * 那里的异常会让 pi 直接退出），会话记的目录不存在时 pi 自己会问要不要在当前目录继续。
 * 校验失败或切换被取消时删掉刚复制的副本。
 */
export async function importSession(ctx: ImportContext, input: string): Promise<EnterOutcome> {
	const source = resolveUserPath(ctx.cwd, input);
	if (!source) throw new Error("no file given");
	if (!existsSync(source)) throw new Error(`file not found: ${source}`);
	const stat = statSync(source);
	if (!stat.isFile()) throw new Error(`not a file: ${source}`);
	// 空文件会被 SessionManager.open 当成新会话初始化，导入它没有意义。
	if (stat.size === 0) throw new Error(`not a pi session file (empty): ${source}`);
	const sessionDir = ctx.sessionManager.getSessionDir();
	mkdirSync(sessionDir, { recursive: true });
	let destination = join(sessionDir, basename(source));
	const alreadyStored = resolve(destination) === source;
	if (!alreadyStored) {
		const { name, ext } = parse(destination);
		for (let suffix = 1; existsSync(destination); suffix++) destination = join(sessionDir, `${name}-${suffix}${ext}`);
		copyFileSync(source, destination, constants.COPYFILE_EXCL);
	}
	try {
		return await resumeSession(ctx, destination);
	} catch (err) {
		if (!alreadyStored) rmSync(destination, { force: true });
		throw err;
	}
}

/** pi's wording when `gh` is missing / not logged in. */
export const GH_NOT_INSTALLED = "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/";
export const GH_NOT_LOGGED_IN = "GitHub CLI is not logged in. Run 'gh auth login' first.";

const DEFAULT_SHARE_VIEWER_URL = "https://pi.dev/session/";

/** pi's getShareViewerUrl: the pi.dev viewer (or `PI_SHARE_VIEWER_URL`) pointed at a gist. */
export function shareViewerUrl(gistId: string): string {
	return `${process.env.PI_SHARE_VIEWER_URL || DEFAULT_SHARE_VIEWER_URL}#${gistId}`;
}

/**
 * Upload `sessionFile` as a secret GitHub gist and return the viewer link (what `/share` does).
 *
 * 照搬 pi 的 gist 路径：`gh auth status` 检查登录 → 导出 HTML 到临时目录 → `gh gist create
 * --public=false` → 从输出的 gist 地址取 id 拼 pi.dev 的查看链接；临时目录最后删掉。pi 会先试
 * Radius（需要 pi 的 modelRuntime，扩展拿不到），这里只走 gist。外发操作，调用方必须先确认。
 */
export async function shareSession(sessionFile: string, commands: ExternalCommands = {}): Promise<ShareResult> {
	if (!existsSync(sessionFile)) throw new Error(`session file not found: ${sessionFile}`);
	const gh = commands.gh ?? { command: "gh", args: [] };
	const auth = await runCommand(gh, ["auth", "status"], GH_TIMEOUT_MS);
	if (auth.error) {
		throw new Error((auth.error as NodeJS.ErrnoException).code === "ENOENT" ? GH_NOT_INSTALLED : `gh auth status: ${auth.error.message}`);
	}
	if (auth.code !== 0) throw new Error(GH_NOT_LOGGED_IN);
	const tempDir = mkdtempSync(join(tmpdir(), "pi-share-"));
	try {
		const htmlFile = join(tempDir, "session.html");
		await exportHtmlFile(sessionFile, htmlFile, commands.pi ?? runningPi());
		const result = await runCommand(gh, ["gist", "create", "--public=false", htmlFile], GH_TIMEOUT_MS);
		if (result.error) throw new Error(`Failed to create gist: ${result.error.message}`);
		if (result.code !== 0) throw new Error(`Failed to create gist: ${result.stderr.trim() || "Unknown error"}`);
		// gh 把进度写到 stderr，stdout 最后一行是 gist 地址。
		const gistUrl = result.stdout.trim().split(/\r?\n/).pop()?.trim() ?? "";
		const gistId = gistUrl.split("/").pop();
		if (!gistId) throw new Error("Failed to parse gist ID from gh output");
		return { url: shareViewerUrl(gistId), gistUrl };
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}
