/**
 * Dialog flows of the SESSIONS pane: Enter resumes, d deletes (the cursor
 * row or the multi-selection, never the session pi has open), r
 * renames, n starts a new session, c compacts, o forks, y clones, Y copies
 * the last reply, e exports, I imports, S shares, i shows the Session Info
 * box. Destructive or outgoing steps confirm first (CLAUDE.md rule 7). Each
 * exported function is one key's flow; the target travels in the dialog
 * callbacks and everything the panel provides comes through `FlowHost`
 * (see ./host.ts).
 *
 * SESSIONS 面板的弹窗流程：每个导出函数对应一个按键，目标由回调闭包带着，面板提供的能力都经 FlowHost。
 */

import { t } from "../../i18n/index.ts";
import { findSessionIndex, sessionTitle } from "../../data/sessions.ts";
import type {
	ContextUsageInfo,
	DeleteMethod,
	ExportFormat,
	ForkPoint,
	RadiusLoginEvent,
	RadiusLoginInteraction,
	RadiusLoginMethod,
	RadiusLoginPrompt,
	SessionInfo,
	SessionRow,
	SessionShareDestination,
	ShareResult,
} from "../../types.ts";
import { alertDialogSpec, cannotDeleteActiveTitle } from "../widgets/alert-dialog.ts";
import { compactDialogHints, compactDialogTitle } from "../widgets/compact-dialog.ts";
import { sessionSubject } from "../widgets/dialog-subject.ts";
import { dialogCloseHint } from "../widgets/dialog-header.ts";
import {
	cloneSessionTitle,
	confirmDialogSpec,
	deleteSessionsTitle,
	deleteSessionTitle,
	forkSessionTitle,
	importSessionTitle,
	overwriteFileTitle,
	radiusSignOutTitle,
} from "../widgets/confirm-dialog.ts";
import { EXPORT_FORMAT_ORDER, exportFormatHints, exportFormats, exportFormatTitle, exportPathHints, exportPathSubject, exportPathTitle } from "../widgets/export-dialog.ts";
import { forkDialogHints, forkDialogSubject, forkDialogTitle } from "../widgets/fork-dialog.ts";
import { importDialogHints, importDialogSubject, importDialogTitle } from "../widgets/import-dialog.ts";
import { newSessionDialogHints, newSessionDialogTitle } from "../widgets/new-session-dialog.ts";
import {
	radiusApiKeyTitle,
	radiusDeviceCode,
	radiusDeviceTitle,
	radiusLoginHints,
	radiusLoginMethodLabel,
	radiusLoginMethodTitle,
	radiusLoginMethods,
	radiusLoginTitle,
	radiusNoticeHints,
	radiusPromptHints,
} from "../widgets/radius-login-dialog.ts";
import { renameDialogHints, renameDialogTitle } from "../widgets/rename-dialog.ts";
import { radiusAccountActions, radiusAccountHints, radiusAccountTitle } from "../widgets/radius-account-dialog.ts";
import { shareDestinations, shareHints, shareInitialIndex, shareTitle } from "../widgets/share-dialog.ts";
import { forgetDeletedSessions } from "./archive-flows.ts";
import type { FlowHost } from "./host.ts";

/** Session `o` forks: its file, title-bar subject and the user messages to pick from. */
interface ForkTarget {
	file: string;
	subject: string;
	points: ForkPoint[];
}

/** Session `e` exports: its file and title-bar subject. */
interface ExportJob {
	file: string;
	subject: string;
}

/** Enter in SESSIONS: switch pi to the session under the cursor (/resume), then close. */
export async function resumeSession(host: FlowHost): Promise<void> {
	const row = host.currentSessionRow();
	if (!row) return;
	const actions = host.actions;
	if (!actions) {
		host.setStatus(t("status.resumeUnavailable"));
		return;
	}
	await host.enter("resume", () => actions.resumeSession(row.file));
}

/**
 * d: ask before deleting the session under the cursor. The session pi has
 * open is refused up front, like pi's /resume (no dialog, just the message).
 */
export function confirmDeleteSession(host: FlowHost): void {
	if (host.state.selectedSessionFiles.size > 0) {
		confirmDeleteSelected(host);
		return;
	}
	const row = host.currentSessionRow();
	if (!row) return;
	if (!host.actions?.deleteSession) {
		host.setStatus(t("status.deleteUnavailable"));
		return;
	}
	// 和 pi 内置 /resume 一样：当前打开的会话不能删；这里弹一个警告框告诉用户为什么。
	if (findSessionIndex([row], host.currentSessionFile) === 0) {
		openCannotDeleteAlert(host, row);
		return;
	}
	host.openMenu(
		"confirm",
		confirmDialogSpec({
			title: deleteSessionTitle(),
			subject: sessionSubject(row),
			onConfirm: () => void deleteSession(host, row),
			onCancel: () => host.closeDialogs(),
		}),
	);
}

/**
 * d with a multi-selection: one confirmation for all selected sessions. The
 * session pi has open is left out (like a single d refuses it); when that
 * leaves nothing the footer says so without asking.
 *
 * 批量删除：列表顺序排好，跳过 pi 当前打开的会话，确认框标题带数量。
 */
function confirmDeleteSelected(host: FlowHost): void {
	if (!host.actions?.deleteSession) {
		host.setStatus(t("status.deleteUnavailable"));
		return;
	}
	const rows = host.sessionRows().filter((r) => host.state.selectedSessionFiles.has(r.file));
	const targets = rows.filter((r) => findSessionIndex([r], host.currentSessionFile) !== 0);
	if (targets.length === 0) {
		// 选中的全是（其实只可能有一个）当前打开的会话：弹警告框，什么都不删。
		const active = rows.find((r) => findSessionIndex([r], host.currentSessionFile) === 0);
		openCannotDeleteAlert(host, active);
		return;
	}
	const skipped = rows.length - targets.length;
	// 当前打开的会话被跳过：它不会被删，也不该继续留在选中里。
	for (const r of rows) if (!targets.includes(r)) host.state.selectedSessionFiles.delete(r.file);
	host.openMenu(
		"confirm",
		confirmDialogSpec({
			title: deleteSessionsTitle(targets.length),
			// 数量已经在标题里；只提示“当前会话被跳过”。拼接多个标题只会被截断。
			...(skipped ? { subject: t("confirm.deleteSkipped") } : {}),
			onConfirm: () => void deleteSelected(host, targets),
			onCancel: () => host.closeDialogs(),
		}),
	);
}

/**
 * Warn (in a box, not just the footer) that the session pi has open can't be
 * deleted. Reuses the select dialog + "confirm" mode so Enter / Esc / OK all
 * dismiss it through `closeDialogs`; nothing is ever deleted from here.
 */
function openCannotDeleteAlert(host: FlowHost, row: SessionRow | undefined): void {
	host.openMenu(
		"confirm",
		alertDialogSpec({
			title: cannotDeleteActiveTitle(),
			...(row ? { subject: sessionSubject(row) } : {}),
			onClose: () => host.closeDialogs(),
		}),
	);
}

/** Yes in the confirmation: remove the file, then re-list with the cursor clamped (TREE / CONTENT follow). */
async function deleteSession(host: FlowHost, row: SessionRow): Promise<void> {
	host.closeDialogs();
	const remove = host.actions?.deleteSession;
	if (!remove) return;
	host.setStatus(t("status.deleting"));
	let method: DeleteMethod;
	try {
		method = await remove(row.file);
		if (host.isDisposed()) return;
	} catch (err) {
		host.setStatus(t("status.deleteFailed", { error: (err as Error).message }));
		return;
	}
	host.state.selectedSessionFiles.delete(row.file);
	const warning = await forgetDeletedSessions(host, [row.file]);
	if (host.isDisposed()) return;
	// 删掉的行没了，光标夹回范围内；光标下换了会话就重新加载右边。
	if (await host.relist(undefined)) host.setStatus([method === "trash" ? t("status.movedToTrash") : t("status.deleted"), warning].filter(Boolean).join(" — "));
	await host.followSessionsCursor();
}

/**
 * Yes on the batch confirmation: delete one by one; the ones that fail stay
 * listed and selected, the first error goes to the footer.
 */
async function deleteSelected(host: FlowHost, targets: SessionRow[]): Promise<void> {
	host.closeDialogs();
	const remove = host.actions?.deleteSession;
	if (!remove || targets.length === 0) return;
	host.setStatus(t("status.deletingN", { count: targets.length }));
	let deleted = 0;
	let firstError: string | undefined;
	const removed: string[] = [];
	for (const row of targets) {
		try {
			await remove(row.file);
			deleted++;
			host.state.selectedSessionFiles.delete(row.file);
			removed.push(row.file);
		} catch (err) {
			firstError ??= `${sessionTitle(row) || t("pane.emptySession")}: ${(err as Error).message}`;
		}
		if (host.isDisposed()) return;
	}
	const warning = await forgetDeletedSessions(host, removed);
	if (host.isDisposed()) return;
	const failed = targets.length - deleted;
	const summary = failed ? t("status.batchDeletedFailed", { deleted, failed, error: firstError }) : t("status.sessionsDeleted", { count: deleted });
	if (await host.relist(undefined)) host.setStatus([summary, warning].filter(Boolean).join(" — "));
	await host.followSessionsCursor();
}

/** r: open the Rename prompt pre-filled with the session's current name. */
export function openRenameInput(host: FlowHost): void {
	if (refuseMultiSelect(host, "rename")) return;
	const row = host.currentSessionRow();
	if (!row) return;
	if (!host.actions?.renameSession) {
		host.setStatus(t("status.renameUnavailable"));
		return;
	}
	// 弹窗标题右侧只标出会话身份（名字/模型 · 日期）：名字本身在输入框里，预览截断后没信息量。
	host.openPrompt("rename", {
		title: renameDialogTitle(),
		value: row.name ?? "",
		subject: sessionSubject(row),
		hints: renameDialogHints(),
		onSubmit: (v) => void submitRename(host, row, v),
		onCancel: () => host.closeDialogs(),
	});
}

/** Enter in the Rename prompt: persist, then re-list so the row shows the new name (cursor stays on it). */
async function submitRename(host: FlowHost, row: SessionRow, value: string): Promise<void> {
	host.closeDialogs();
	const rename = host.actions?.renameSession;
	if (!rename) return;
	const name = value.trim();
	try {
		await rename(row.file, name);
		if (host.isDisposed()) return;
	} catch (err) {
		host.setStatus(t("status.renameFailed", { error: (err as Error).message }));
		return;
	}
	if (await host.relist(row.file)) host.setStatus(name ? t("status.renamed", { name }) : t("status.nameRemoved"));
	// 改名会在会话文件里追加一条 session_info：TREE 在 all 过滤下要能看到它，光标留在原节点。
	await host.refreshSession(row.file);
}

/** n: prompt for an optional name, then start a fresh session (/new) and close the panel. */
export function openNewSessionInput(host: FlowHost): void {
	if (!host.actions?.newSession) {
		host.setStatus(t("status.newUnavailable"));
		return;
	}
	host.openPrompt("new", {
		title: newSessionDialogTitle(),
		value: "",
		hints: newSessionDialogHints(),
		onSubmit: (v) => void submitNewSession(host, v),
		onCancel: () => host.closeDialogs(),
	});
}

/** Enter in the New session prompt: create it (naming it when non-empty), then close via `enter()`. */
async function submitNewSession(host: FlowHost, value: string): Promise<void> {
	const create = host.actions?.newSession;
	host.closeDialogs();
	if (!create) return;
	const name = value.trim();
	await host.enter("new", () => create(name));
}

/** c: prompt for optional focus instructions, then compact the cursor session (/compact) and open it. */
export function openCompactInput(host: FlowHost): void {
	if (refuseMultiSelect(host, "compact")) return;
	const row = host.currentSessionRow();
	if (!row) return;
	if (!host.actions?.compactSession) {
		host.setStatus(t("status.compactUnavailable"));
		return;
	}
	// 标题右侧显示压缩的是哪个会话（名字/模型 · 日期）；输入框留空 = 用 pi 的默认压缩指令。
	host.openPrompt("compact", {
		title: compactDialogTitle(),
		value: "",
		subject: sessionSubject(row),
		hints: compactDialogHints(),
		onSubmit: (v) => void submitCompact(host, row, v),
		onCancel: () => host.closeDialogs(),
	});
}

/** Enter in the Compact prompt: compact the session (blank = pi's default instructions), then close via `enter()`. */
async function submitCompact(host: FlowHost, row: SessionRow, value: string): Promise<void> {
	const compact = host.actions?.compactSession;
	host.closeDialogs();
	if (!compact) return;
	const instructions = value.trim();
	await host.enter("compact", () => compact(row.file, instructions || undefined));
}

/** o: pick the user message to fork before (pi's /fork selector), then confirm and fork. */
export async function startFork(host: FlowHost): Promise<void> {
	if (refuseMultiSelect(host, "fork")) return;
	const row = host.currentSessionRow();
	if (!row) return;
	if (!host.actions?.forkSession || !host.data.loadForkPoints) {
		host.setStatus(t("status.forkUnavailable"));
		return;
	}
	let points: ForkPoint[];
	try {
		points = await host.data.loadForkPoints(row.file);
		if (host.isDisposed()) return;
	} catch (err) {
		host.setStatus(t("status.forkFailed", { error: (err as Error).message }));
		return;
	}
	if (points.length === 0) {
		host.setStatus(t("status.noForkMessages"));
		return;
	}
	// 默认停在最后一条 user 消息（和 pi 内置 /fork 一致）。
	openForkSelector(host, { file: row.file, subject: sessionSubject(row), points }, points.length - 1);
}

/** The fork selector with the cursor on `index` (Esc / No on the confirmation comes back onto that message). */
function openForkSelector(host: FlowHost, target: ForkTarget, index: number): void {
	host.openMenu("fork", {
		title: forkDialogTitle(),
		items: target.points.map((p) => p.text),
		initialIndex: index,
		subject: target.subject,
		hints: forkDialogHints(),
		// 消息多了按窗口滚动，不撑破终端。
		maxRows: host.dialogMaxRows(),
		onSelect: (i) => confirmFork(host, target, i),
		onCancel: () => host.closeDialogs(),
	});
}

/** A picked message → the Yes / No confirmation (CLAUDE.md rule 7) before the fork happens. */
function confirmFork(host: FlowHost, target: ForkTarget, index: number): void {
	const point = target.points[index];
	if (!point) {
		host.closeDialogs();
		return;
	}
	host.openMenu(
		"fork",
		confirmDialogSpec({
			title: forkSessionTitle(),
			// 只回显“第几条”：正文在选择器里刚看过，塞进标题栏只会被截成省略号。
			subject: forkDialogSubject(index, target.points.length),
			onConfirm: () => void runFork(host, target.file, point.entryId),
			// Esc / No：退回选择器，光标停在刚选中的那条消息上。
			onCancel: () => openForkSelector(host, target, index),
		}),
	);
}

/** Confirmed: fork before the picked message (pi puts its text back into the fork's editor), then close. */
async function runFork(host: FlowHost, file: string, entryId: string): Promise<void> {
	const fork = host.actions?.forkSession;
	host.closeDialogs();
	if (!fork) return;
	await host.enter("fork", () => fork(file, entryId));
}

/** y: confirm, then clone the active branch of the session under the cursor to a new file (/clone). */
export function confirmCloneSession(host: FlowHost): void {
	if (refuseMultiSelect(host, "clone")) return;
	const row = host.currentSessionRow();
	if (!row) return;
	if (!host.actions?.cloneSession) {
		host.setStatus(t("status.cloneUnavailable"));
		return;
	}
	host.openMenu(
		"clone",
		confirmDialogSpec({
			title: cloneSessionTitle(),
			subject: sessionSubject(row),
			onConfirm: () => void runClone(host, row),
			onCancel: () => host.closeDialogs(),
		}),
	);
}

async function runClone(host: FlowHost, row: SessionRow): Promise<void> {
	const clone = host.actions?.cloneSession;
	host.closeDialogs();
	if (!clone) return;
	await host.enter("clone", () => clone(row.file));
}

/** Y: copy the last assistant reply of the session under the cursor to the clipboard (/copy). */
export async function copyLastReply(host: FlowHost): Promise<void> {
	const row = host.currentSessionRow();
	if (!row) return;
	const copy = host.actions?.copyLastReply;
	if (!copy) {
		host.setStatus(t("status.copyUnavailable"));
		return;
	}
	try {
		const copied = await copy(row.file);
		if (host.isDisposed()) return;
		host.setStatus(copied ? t("status.copiedLastReply") : t("status.noReplyToCopy"));
	} catch (err) {
		host.setStatus(t("status.copyFailed", { error: (err as Error).message }));
	}
}

/** e: pick HTML / JSONL, then the output path, for the session under the cursor (/export). */
export function startExport(host: FlowHost): void {
	if (refuseMultiSelect(host, "export")) return;
	const row = host.currentSessionRow();
	if (!row) return;
	if (!host.actions?.exportSession || !host.actions.exportTarget) {
		host.setStatus(t("status.exportUnavailable"));
		return;
	}
	openExportMenu(host, { file: row.file, subject: sessionSubject(row) }, 0);
}

/** The format menu with the cursor on `index` (Esc from the path prompt comes back onto the chosen format). */
function openExportMenu(host: FlowHost, job: ExportJob, index: number): void {
	host.openMenu("export", {
		title: exportFormatTitle(),
		items: exportFormats().map((f) => f.label),
		initialIndex: index,
		subject: job.subject,
		hints: exportFormatHints(),
		onSelect: (i) => {
			const format = exportFormats()[i]?.format;
			if (format) openExportPath(host, job, format);
		},
		onCancel: () => host.closeDialogs(),
	});
}

/**
 * The output-path prompt, pre-filled with pi's default (or `value`, what the
 * user typed before backing out of the overwrite confirmation).
 */
function openExportPath(host: FlowHost, job: ExportJob, format: ExportFormat, value?: string): void {
	const resolveTarget = host.actions?.exportTarget;
	if (!resolveTarget) return;
	host.openPrompt("export", {
		title: exportPathTitle(),
		// 预填 pi 的默认路径（绝对路径），用户一眼能看到会写到哪里；改成目录就在里面用默认文件名。
		value: value ?? resolveTarget(job.file, format, "").path,
		// 右上角提示这个框要填什么（而不是会话名，格式菜单上已经显示过会话了）。
		subject: exportPathSubject(),
		hints: exportPathHints(),
		onSubmit: (v) => submitExportPath(host, job, format, v),
		// Esc：退回格式菜单，光标停在刚选的格式上。
		onCancel: () => openExportMenu(host, job, EXPORT_FORMAT_ORDER.indexOf(format)),
	});
}

/** Enter in the path prompt: export right away, or ask first when a file is already there. */
function submitExportPath(host: FlowHost, job: ExportJob, format: ExportFormat, value: string): void {
	const resolveTarget = host.actions?.exportTarget;
	if (!resolveTarget) {
		host.closeDialogs();
		return;
	}
	const target = resolveTarget(job.file, format, value);
	if (!target.exists) {
		void runExport(host, job.file, format, target.path);
		return;
	}
	// 覆盖已有文件是破坏性操作，先确认（CLAUDE.md 第 7 条）；No / Esc 退回路径输入框，保留刚才输入的内容。
	host.openMenu(
		"export",
		confirmDialogSpec({
			title: overwriteFileTitle(),
			subject: target.path,
			onConfirm: () => void runExport(host, job.file, format, target.path),
			onCancel: () => openExportPath(host, job, format, value),
		}),
	);
}

/** Write the export; the panel stays open and the footer says where the file went. */
async function runExport(host: FlowHost, file: string, format: ExportFormat, path: string): Promise<void> {
	const write = host.actions?.exportSession;
	host.closeDialogs();
	if (!write) return;
	host.setStatus(t("status.exporting"));
	try {
		const written = await write(file, format, path);
		if (host.isDisposed()) return;
		host.setStatus(t("status.exportedTo", { path: written }));
	} catch (err) {
		if (host.isDisposed()) return;
		host.setStatus(t("status.exportFailed", { error: (err as Error).message }));
	}
}

/** I: ask for the JSONL to import (`value` = what was typed before backing out of the confirmation). */
export function openImportInput(host: FlowHost, value: string): void {
	if (!host.actions?.importSession) {
		host.setStatus(t("status.importUnavailable"));
		return;
	}
	host.openPrompt("import", {
		title: importDialogTitle(),
		value,
		subject: importDialogSubject(),
		hints: importDialogHints(),
		onSubmit: (v) => confirmImport(host, v),
		onCancel: () => host.closeDialogs(),
	});
}

/** Enter in the import prompt: confirm like pi's /import ("Replace current session with …?"). */
function confirmImport(host: FlowHost, value: string): void {
	const path = value.trim();
	if (!path) {
		host.closeDialogs();
		host.setStatus(t("status.importNoFile"));
		return;
	}
	host.openMenu(
		"import",
		confirmDialogSpec({
			title: importSessionTitle(),
			subject: path,
			onConfirm: () => void runImport(host, path),
			// Esc / No：退回输入框，保留刚才输入的路径。
			onCancel: () => openImportInput(host, value),
		}),
	);
}

/** Confirmed: copy the file into the session folder and switch to it, closing the panel via `enter()`. */
async function runImport(host: FlowHost, input: string): Promise<void> {
	const load = host.actions?.importSession;
	host.closeDialogs();
	if (!load) return;
	await host.enter("import", () => load(input));
}

/**
 * S: pick the destination (Auto / GitHub Gist / Radius) and upload (/share).
 *
 * 菜单本身就是外发确认：Esc 什么都不发。初始光标是 pi 的 `sessionShareDestination`
 * （没配置为 auto）；Gist 缺工具 / Auto 两边都不可用由动作层按 pi 的原文报在 footer。
 *
 * Radius 单独处理：没登录时走 pi 的 `/login radius` 流程（账号 / API Key，
 * 账号再用同一个菜单选浏览器 / 设备码），登录成功后自动继续这次分享；已登录时先弹
 * "分享 / 退出登录"，退出会清除本机凭据（相当于 pi 的 `/logout radius`）。
 */
export function confirmShareSession(host: FlowHost): void {
	if (refuseMultiSelect(host, "share")) return;
	const row = host.currentSessionRow();
	if (!row) return;
	if (!host.actions?.shareSession) {
		host.setStatus(t("status.shareUnavailable"));
		return;
	}
	const entries = shareDestinations();
	host.openMenu("share", {
		title: shareTitle(),
		items: entries.map((e) => e.label),
		initialIndex: shareInitialIndex(host.actions.shareDestination ?? "auto"),
		subject: dialogCloseHint(),
		closeOnQ: true,
		hints: shareHints(),
		onSelect: (i) => {
			const destination = entries[i]?.destination;
			if (destination) void startShare(host, row, destination);
		},
		onCancel: () => host.closeDialogs(),
	});
}

/**
 * "Sign out of Radius" in the account menu: ask first (it removes the stored
 * credential), then delete it.
 *
 * 退出 Radius 登录前先确认（CLAUDE.md 第 7 条：删除类操作）；确认后只删本机
 * auth.json 里的凭据，网页端已创建的会话不受影响。Esc / No 退回账号菜单。
 */
function confirmRadiusSignOut(host: FlowHost, row: SessionRow): void {
	if (!host.actions?.logoutRadius) {
		// 没接动作时把菜单收掉，只留 footer 提示，和别的"操作不可用"一致。
		host.closeDialogs();
		host.setStatus(t("status.radiusSignOutUnavailable"));
		return;
	}
	host.openMenu(
		"share",
		confirmDialogSpec({
			title: radiusSignOutTitle(),
			onConfirm: () => void runRadiusSignOut(host),
			onCancel: () => openRadiusAccount(host, row),
		}),
	);
}

/** Confirmed: remove the credential and report it in the footer. */
async function runRadiusSignOut(host: FlowHost): Promise<void> {
	const logout = host.actions?.logoutRadius;
	host.closeDialogs();
	if (!logout) return;
	host.setStatus(t("status.radiusSigningOut"));
	try {
		await logout();
		if (host.isDisposed()) return;
		host.setStatus(t("status.radiusSignedOut"));
	} catch (err) {
		if (host.isDisposed()) return;
		host.setStatus(t("status.radiusSignOutFailed", { error: (err as Error).message }));
	}
}

/**
 * Upload to the picked destination, taking over Radius sign-in first when an
 * explicit Radius share finds no credential; when one is stored, ask whether
 * to share or sign out instead of uploading right away.
 */
async function startShare(host: FlowHost, row: SessionRow, destination: SessionShareDestination): Promise<void> {
	const actions = host.actions;
	if (!actions?.shareSession) {
		host.closeDialogs();
		host.setStatus(t("status.shareUnavailable"));
		return;
	}
	host.closeDialogs();
	if (destination === "radius" && actions.radiusAuthenticated) {
		let ready: boolean;
		try {
			ready = await actions.radiusAuthenticated();
		} catch {
			// 取凭据失败（如 OAuth 刷新出错）按未登录处理，和 share 的判断一致。
			ready = false;
		}
		if (host.isDisposed()) return;
		if (ready) {
			openRadiusAccount(host, row);
			return;
		}
		// 没接登录动作时继续走分享，让动作层按 pi 的原文报"未登录"。
		if (actions.loginRadius) {
			openRadiusLogin(host, row);
			return;
		}
	}
	await runShare(host, row.file, destination);
}

/** Signed in: share right away, or clear the credential after a confirmation. */
function openRadiusAccount(host: FlowHost, row: SessionRow): void {
	const actions = radiusAccountActions();
	host.openMenu("share", {
		title: radiusAccountTitle(),
		items: actions.map((a) => a.label),
		subject: dialogCloseHint(),
		closeOnQ: true,
		hints: radiusAccountHints(),
		onSelect: (i) => {
			const action = actions[i]?.action;
			if (action === "share") void runShare(host, row.file, "radius");
			else if (action === "logout") confirmRadiusSignOut(host, row);
		},
		onCancel: () => host.closeDialogs(),
	});
}

/** The account / API-key menu, same two choices as pi's `/login radius`. */
function openRadiusLogin(host: FlowHost, row: SessionRow): void {
	if (!host.actions?.loginRadius) return;
	const methods = radiusLoginMethods();
	host.openMenu("share", {
		title: radiusLoginTitle(),
		items: methods.map((m) => m.label),
		subject: dialogCloseHint(),
		closeOnQ: true,
		hints: radiusLoginHints(),
		onSelect: (i) => {
			const method = methods[i]?.method;
			if (method) void runRadiusLogin(host, row, method);
		},
		onCancel: () => host.closeDialogs(),
	});
}

/**
 * Run pi's Radius sign-in with the panel as its UI (prompts become dialogs,
 * auth URLs / device codes become a notice), then share the session.
 */
async function runRadiusLogin(host: FlowHost, row: SessionRow, method: RadiusLoginMethod): Promise<void> {
	const login = host.actions?.loginRadius;
	if (!login) return;
	host.closeDialogs();
	host.setStatus(t("status.radiusSigningIn"));
	const controller = new AbortController();
	// 浏览器登录期间没有弹窗：Esc 取消这次登录，而不是把整个面板关掉（footer 里也提示了）。
	host.setPendingCancel(() => controller.abort());
	let failure: Error | undefined;
	try {
		await login(method, radiusLoginInteraction(host, controller));
	} catch (err) {
		failure = err instanceof Error ? err : new Error(String(err));
	} finally {
		host.setPendingCancel(undefined);
	}
	if (host.isDisposed()) return;
	if (controller.signal.aborted) {
		host.closeDialogs();
		host.setStatus(t("status.radiusLoginCancelled"));
		return;
	}
	host.closeDialogs();
	if (failure) {
		host.setStatus(t("status.radiusLoginFailed", { error: failure.message }));
		return;
	}
	host.setStatus(t("status.radiusSignedIn"));
	await runShare(host, row.file, "radius");
}

/** The callbacks pi's login uses; the signal cancels the browser wait / device poll. */
function radiusLoginInteraction(host: FlowHost, controller: AbortController): RadiusLoginInteraction {
	return {
		signal: controller.signal,
		prompt: (prompt) => promptRadiusLogin(host, prompt, controller),
		notify: (event) => notifyRadiusLogin(host, event, controller),
	};
}

/**
 * One pi sign-in prompt as a panel dialog: a menu for choices (browser / device
 * code), the shared input dialog for text / the API key. Esc aborts the login.
 */
function promptRadiusLogin(host: FlowHost, prompt: RadiusLoginPrompt, controller: AbortController): Promise<string> {
	return new Promise((resolve, reject) => {
		if (controller.signal.aborted || prompt.signal?.aborted) {
			reject(new Error("Login cancelled"));
			return;
		}
		let settled = false;
		const cancel = (): void => {
			if (settled) return;
			settled = true;
			host.closeDialogs();
			controller.abort();
			reject(new Error("Login cancelled"));
		};
		// 某些 pi 流程会用它自己的 signal 取消一个已被别的事件解决掉的提示。
		prompt.signal?.addEventListener("abort", cancel, { once: true });
		if (prompt.type === "select") {
			const options = prompt.options ?? [];
			// pi 的选项文案带括号说明（"(recommended)" 等），面板用自己的译文；不认识的 id 照旧用 pi 的。
			const labels = options.map((o) => radiusLoginMethodLabel(o.id));
			host.openMenu("share", {
				title: labels.some((label) => label !== undefined) ? radiusLoginMethodTitle() : prompt.message,
				items: options.map((o, i) => labels[i] ?? o.label),
				subject: dialogCloseHint(),
				closeOnQ: true,
				hints: radiusLoginHints(),
				onSelect: (i) => {
					if (settled) return;
					const option = options[i];
					if (!option) {
						cancel();
						return;
					}
					settled = true;
					host.closeDialogs();
					resolve(option.id);
				},
				onCancel: cancel,
			});
			return;
		}
		host.openPrompt("share", {
			// pi 的 API Key 提示是英文原文（"Enter Radius API key"），面板用自己的译文。
			title: prompt.type === "secret" ? radiusApiKeyTitle() : prompt.message,
			...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
			hints: radiusPromptHints(),
			...(prompt.type === "secret" ? { validate: (value: string) => (value.trim() ? undefined : t("status.radiusApiKeyRequired")) } : {}),
			onSubmit: (value) => {
				if (settled) return;
				settled = true;
				host.closeDialogs();
				resolve(value);
			},
			onCancel: cancel,
		});
	});
}

/**
 * Show what pi's sign-in reported: progress in the footer, the browser link on
 * the clipboard (the browser opens automatically, like /login does — no box
 * over the panel), the device code in a notice.
 * Closing the device-code notice cancels the login.
 */
function notifyRadiusLogin(host: FlowHost, event: RadiusLoginEvent, controller: AbortController): void {
	if (host.isDisposed() || controller.signal.aborted) return;
	if (event.type === "progress") {
		host.setStatus(event.message);
		return;
	}
	if (event.type === "auth_url") {
		// 浏览器登录不弹框：链接直接进剪贴板，footer 说明正在等浏览器（Esc 取消）。
		host.actions?.openUrl?.(event.url);
		void copyRadiusBrowserLink(host, event.url);
		return;
	}
	if (event.type === "device_code") {
		host.actions?.openUrl?.(event.verificationUri);
		const lines = [radiusDeviceCode(event.userCode), event.verificationUri];
		openRadiusNotice(host, controller, radiusDeviceTitle(), lines, `${event.userCode} ${event.verificationUri}`);
		return;
	}
	// info：pi 给一段说明和若干链接（Radius 目前不会走到这里，保持和 /login 一致）。
	const lines = [event.message, ...(event.links ?? []).map((link) => (link.label ? `${link.label}: ${link.url}` : link.url))];
	openRadiusNotice(host, controller, radiusLoginTitle(), lines, event.links?.[0]?.url);
}

/** The device-code / info notice: Esc cancels; `y` copies the code / link when there is one. */
function openRadiusNotice(host: FlowHost, controller: AbortController, title: string, lines: string[], copyText: string | undefined): void {
	host.openNotice("share", {
		title,
		lines,
		hints: radiusNoticeHints(copyText !== undefined),
		...(copyText !== undefined ? { onCopy: () => void copyRadiusNotice(host, copyText) } : {}),
		onClose: () => {
			host.closeDialogs();
			controller.abort();
		},
	});
}

/** `y` in the sign-in notice: the link / code goes to the clipboard, the notice stays open. */
async function copyRadiusNotice(host: FlowHost, text: string): Promise<void> {
	const copy = host.actions?.copyText;
	if (!copy) return;
	try {
		await copy(text);
		if (!host.isDisposed()) host.setStatus(t("status.copiedRadiusLink"));
	} catch (err) {
		if (!host.isDisposed()) host.setStatus(t("status.copyFailed", { error: (err as Error).message }));
	}
}

/**
 * Browser sign-in: the link goes to the clipboard (no box covers the panel),
 * the footer says what to do. A failing clipboard only changes the message —
 * the browser was already opened and may be all the user needs.
 */
async function copyRadiusBrowserLink(host: FlowHost, url: string): Promise<void> {
	const copy = host.actions?.copyText;
	let copied = false;
	if (copy) {
		try {
			await copy(url);
			copied = true;
		} catch {
			// 剪贴板不可用不挡住登录：footer 里给出完整链接。
		}
	}
	if (host.isDisposed()) return;
	host.setStatus(copied ? t("status.radiusBrowserLinkCopied") : t("status.radiusBrowserLink", { url }));
}

/** Upload, then put the viewer link on the clipboard (a long link may not fit the footer) and show it. */
async function runShare(host: FlowHost, file: string, destination: SessionShareDestination): Promise<void> {
	const share = host.actions?.shareSession;
	host.closeDialogs();
	if (!share) return;
	host.setStatus(t("status.sharing"));
	let result: ShareResult;
	try {
		result = await share(file, destination);
		if (host.isDisposed()) return;
	} catch (err) {
		if (host.isDisposed()) return;
		host.setStatus(t("status.shareFailed", { error: (err as Error).message }));
		return;
	}
	const copy = host.actions?.copyText;
	try {
		if (!copy) throw new Error("no clipboard");
		await copy(result.url);
		if (host.isDisposed()) return;
		host.setStatus(t("status.shareUrlCopied", { url: result.url }));
	} catch {
		if (host.isDisposed()) return;
		host.setStatus(t("status.shared", { url: result.url }));
	}
}

/** i: load what /session shows for the session under the cursor and open the info box. */
export async function openSessionInfo(host: FlowHost): Promise<void> {
	const row = host.currentSessionRow();
	if (!row) return;
	const load = host.data.loadSessionInfo;
	if (!load) {
		host.setStatus(t("status.sessionInfoUnavailable"));
		return;
	}
	let info: SessionInfo | undefined;
	try {
		info = await load(row.file);
	} catch (err) {
		host.setStatus(t("status.sessionInfoFailed", { error: (err as Error).message }));
		return;
	}
	if (host.isDisposed()) return;
	if (!info) {
		host.setStatus(t("status.sessionInfoCannotRead", { file: row.file }));
		return;
	}
	host.openInfo(info, (text) => void copySessionInfo(host, text));
}

/** y in the info box: the whole text goes to the clipboard, the box stays open. */
async function copySessionInfo(host: FlowHost, text: string): Promise<void> {
	const copy = host.actions?.copyText;
	if (!copy) {
		host.setStatus(t("status.copyUnavailable"));
		return;
	}
	try {
		await copy(text);
		if (host.isDisposed()) return;
		host.setStatus(t("status.copiedSessionInfo"));
	} catch (err) {
		host.setStatus(t("status.copyFailed", { error: (err as Error).message }));
	}
}

/** u: load the context-window usage for the session under the cursor and open the usage box. */
export async function openContextUsage(host: FlowHost): Promise<void> {
	if (refuseMultiSelect(host, "usage")) return;
	const row = host.currentSessionRow();
	if (!row) return;
	const load = host.data.loadContextUsage;
	if (!load) {
		host.setStatus(t("status.usageUnavailable"));
		return;
	}
	let info: ContextUsageInfo | undefined;
	try {
		info = await load(row.file);
	} catch (err) {
		host.setStatus(t("status.usageFailed", { error: (err as Error).message }));
		return;
	}
	if (host.isDisposed()) return;
	if (!info) {
		host.setStatus(t("status.usageCannotRead", { file: row.file }));
		return;
	}
	host.openUsage(info, (text) => void copyContextUsage(host, text));
}

/** y in the usage box: the whole text goes to the clipboard, the box stays open. */
async function copyContextUsage(host: FlowHost, text: string): Promise<void> {
	const copy = host.actions?.copyText;
	if (!copy) {
		host.setStatus(t("status.copyUnavailable"));
		return;
	}
	try {
		await copy(text);
		if (host.isDisposed()) return;
		host.setStatus(t("status.copiedContextUsage"));
	} catch (err) {
		host.setStatus(t("status.copyFailed", { error: (err as Error).message }));
	}
}

/**
 * Actions that only make sense for one session (rename, fork, clone, export,
 * share) refuse while several sessions are selected. Returns true when refused.
 */
function refuseMultiSelect(host: FlowHost, label: string): boolean {
	if (host.state.selectedSessionFiles.size <= 1) return false;
	host.setStatus(t("status.multiSelectRefused", { action: t(`enter.${label}`) }));
	return true;
}
