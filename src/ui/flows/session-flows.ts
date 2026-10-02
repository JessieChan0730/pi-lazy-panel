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
import { findSessionIndex } from "../../data/sessions.ts";
import type { ContextUsageInfo, DeleteMethod, ExportFormat, ForkPoint, SessionInfo, SessionRow, ShareResult } from "../../types.ts";
import { alertDialogSpec, cannotDeleteActiveTitle } from "../widgets/alert-dialog.ts";
import { compactDialogHints, compactDialogTitle } from "../widgets/compact-dialog.ts";
import {
	cloneSessionTitle,
	confirmDialogSpec,
	deleteSessionsTitle,
	deleteSessionTitle,
	forkSessionTitle,
	importSessionTitle,
	overwriteFileTitle,
	shareSessionTitle,
} from "../widgets/confirm-dialog.ts";
import { EXPORT_FORMAT_ORDER, exportFormatHints, exportFormats, exportFormatTitle, exportPathHints, exportPathTitle } from "../widgets/export-dialog.ts";
import { forkDialogHints, forkDialogTitle } from "../widgets/fork-dialog.ts";
import { importDialogHints, importDialogSubject, importDialogTitle } from "../widgets/import-dialog.ts";
import { newSessionDialogHints, newSessionDialogTitle } from "../widgets/new-session-dialog.ts";
import { renameDialogHints, renameDialogTitle } from "../widgets/rename-dialog.ts";
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
		openCannotDeleteAlert(host, sessionTitle(row));
		return;
	}
	host.openMenu(
		"confirm",
		confirmDialogSpec({
			title: deleteSessionTitle(),
			subject: sessionTitle(row),
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
		openCannotDeleteAlert(host, active ? sessionTitle(active) : undefined);
		return;
	}
	const skipped = rows.length - targets.length;
	// 当前打开的会话被跳过：它不会被删，也不该继续留在选中里。
	for (const r of rows) if (!targets.includes(r)) host.state.selectedSessionFiles.delete(r.file);
	host.openMenu(
		"confirm",
		confirmDialogSpec({
			title: deleteSessionsTitle(targets.length),
			subject: skipped
				? t("confirm.deleteSkipped", { subjects: targets.map((r) => sessionTitle(r)).join(", ") })
				: targets.map((r) => sessionTitle(r)).join(", "),
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
function openCannotDeleteAlert(host: FlowHost, subject: string | undefined): void {
	host.openMenu(
		"confirm",
		alertDialogSpec({
			title: cannotDeleteActiveTitle(),
			...(subject ? { subject } : {}),
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
			firstError ??= `${sessionTitle(row)}: ${(err as Error).message}`;
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
	// 弹窗标题右侧显示是给哪个会话改名（首条消息预览，名字本身在输入框里）。
	host.openPrompt("rename", {
		title: renameDialogTitle(),
		value: row.name ?? "",
		subject: row.preview || row.id,
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
	// 标题右侧显示压缩的是哪个会话（首条消息预览）；输入框留空 = 用 pi 的默认压缩指令。
	host.openPrompt("compact", {
		title: compactDialogTitle(),
		value: "",
		subject: row.preview || row.id,
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
	openForkSelector(host, { file: row.file, subject: sessionTitle(row), points }, points.length - 1);
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
			subject: point.text,
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
			subject: sessionTitle(row),
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
	openExportMenu(host, { file: row.file, subject: sessionTitle(row) }, 0);
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
		subject: job.subject,
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

/** S: confirm (the session leaves the machine), then upload it as a secret gist (/share). */
export function confirmShareSession(host: FlowHost): void {
	if (refuseMultiSelect(host, "share")) return;
	const row = host.currentSessionRow();
	if (!row) return;
	if (!host.actions?.shareSession) {
		host.setStatus(t("status.shareUnavailable"));
		return;
	}
	host.openMenu(
		"share",
		confirmDialogSpec({
			title: shareSessionTitle(),
			subject: sessionTitle(row),
			onConfirm: () => void runShare(host, row.file),
			onCancel: () => host.closeDialogs(),
		}),
	);
}

/** Upload, then put the viewer link on the clipboard (a long link may not fit the footer) and show it. */
async function runShare(host: FlowHost, file: string): Promise<void> {
	const share = host.actions?.shareSession;
	host.closeDialogs();
	if (!share) return;
	host.setStatus(t("status.sharing"));
	let result: ShareResult;
	try {
		result = await share(file);
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

/** Title of a session as the pane shows it: its name, else the first-message preview. */
function sessionTitle(row: SessionRow): string {
	return row.name ?? row.preview ?? "(empty session)";
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
