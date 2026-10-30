/** Session organization flows: explicit file targets, atomic persistence, then refresh. */
import { t } from "../../i18n/index.ts";
import { findSessionIndex, sessionTitle } from "../../data/sessions.ts";
import type { DeleteMethod, SessionFileChange, SessionRow } from "../../types.ts";
import { sessionFileKey } from "../../utils/session-file-key.ts";
import { applySessionFileState } from "../state.ts";
import { alertDialogSpec, cannotDeleteActiveTitle } from "../widgets/alert-dialog.ts";
import { confirmDialogSpec, deleteSessionsTitle, deleteSessionTitle } from "../widgets/confirm-dialog.ts";
import { sessionSubject } from "../widgets/dialog-subject.ts";
import type { FlowHost } from "./host.ts";

/** Selected rows take precedence over the cursor, just like batch deletion. */
function targetsFor(host: FlowHost): string[] {
	if (host.state.selectedSessionFiles.size > 0) {
		return host.sessionRows().filter((r) => host.state.selectedSessionFiles.has(r.file)).map((r) => r.file);
	}
	const row = host.currentSessionRow();
	return row ? [row.file] : [];
}

/** Keep the cursor's survivor, otherwise its next neighbour (or the previous at the end). */
function neighbourAfterRemoving(host: FlowHost, files: readonly string[]): string | undefined {
	const removed = new Set(files.map(sessionFileKey));
	const rows = host.sessionRows();
	const index = host.state.cursor.sessions;
	return rows.slice(index).find((r) => !removed.has(sessionFileKey(r.file)))?.file ??
		rows.slice(0, index).reverse().find((r) => !removed.has(sessionFileKey(r.file)))?.file;
}

/** x archives the selected / cursor session from the normal list; never touches the JSONL. */
export async function toggleArchive(host: FlowHost): Promise<void> {
	if (host.state.sessionStateBusy) return;
	if (!host.actions?.updateSessionState) {
		host.setStatus(t("status.archiveUnavailable"));
		return;
	}
	const files = targetsFor(host);
	if (!files.length) return;
	const status = t("status.sessionsArchived", { count: files.length, hint: host.archiveOpenHint() });
	await changeSessionFiles(host, { type: "archive", files }, neighbourAfterRemoving(host, files), status);
}

/** p: if any target is unpinned, pin the group; otherwise unpin it. */
export async function togglePin(host: FlowHost): Promise<void> {
	if (host.state.sessionStateBusy) return;
	if (!host.actions?.updateSessionState) {
		host.setStatus(t("status.pinUnavailable"));
		return;
	}
	const files = targetsFor(host);
	if (!files.length) return;
	const pinned = new Set(host.state.pinnedFiles.map(sessionFileKey));
	const unpinned = files.filter((f) => !pinned.has(sessionFileKey(f)));
	const pinning = unpinned.length > 0;
	await changeSessionFiles(
		host,
		{ type: pinning ? "pin" : "unpin", files },
		host.sessionRows()[host.state.cursor.sessions]?.file,
		pinning ? t("status.pinned", { count: unpinned.length }) : t("status.unpinned", { count: files.length }),
	);
}

async function changeSessionFiles(host: FlowHost, change: SessionFileChange, keep: string | undefined, status: string): Promise<void> {
	const update = host.actions?.updateSessionState;
	if (!update) return;
	host.state.sessionStateBusy = true;
	host.setStatus(t("status.savingSessionState"));
	try {
		// 先提交再更新 UI：归档和取消置顶同一次落盘，失败不让任何行消失。
		const saved = await update(change);
		if (host.isDisposed()) return;
		applySessionFileState(host.state, saved);
		host.state.listScroll.sessions = null;
		if (await host.relist(keep)) host.setStatus(saved.warning ? t("status.sessionStateSavedWarning", { error: saved.warning }) : status);
		await host.followSessionsCursor();
	} catch (err) {
		if (host.isDisposed()) return;
		const error = (err as Error).message;
		host.setStatus(change.type === "pin" || change.type === "unpin" ? t("status.pinFailed", { error }) : t("status.archiveFailed", { error }));
	} finally {
		host.state.sessionStateBusy = false;
	}
}

/**
 * Enter / R in the archive dialog: unarchive these rows in one write and put
 * them back into the SESSIONS list. One call for the whole group, so a batch
 * restore is a single metadata write and a single relist.
 */
export async function restoreArchivedSessions(host: FlowHost, rows: readonly SessionRow[]): Promise<void> {
	if (host.state.sessionStateBusy || rows.length === 0) return;
	const update = host.actions?.updateSessionState;
	if (!update) {
		host.setStatus(t("status.archiveUnavailable"));
		return;
	}
	const files = rows.map((row) => row.file);
	host.state.sessionStateBusy = true;
	host.setStatus(t("status.savingSessionState"));
	try {
		const saved = await update({ type: "unarchive", files });
		if (host.isDisposed()) return;
		applySessionFileState(host.state, saved);
		const keep = host.sessionRows()[host.state.cursor.sessions]?.file;
		// 恢复成功后这些行不可能还在归档里：本地删掉即可，不用再扫一遍所有目录。
		host.removeArchivedRows(files);
		if (await host.relist(keep)) {
			host.setStatus(saved.warning
				? t("status.sessionStateSavedWarning", { error: saved.warning })
				: t("status.sessionsUnarchived", { count: files.length }));
		}
		await host.followSessionsCursor();
	} catch (err) {
		if (host.isDisposed()) return;
		host.setStatus(t("status.archiveFailed", { error: (err as Error).message }));
	} finally {
		host.state.sessionStateBusy = false;
	}
}

/**
 * d / D in the archive dialog: confirm, then delete the files for good. The
 * session pi has open is skipped (a single d on it only shows the warning).
 */
export function confirmDeleteArchivedSessions(host: FlowHost, rows: readonly SessionRow[]): void {
	if (!rows.length) return;
	if (!host.actions?.deleteSession) {
		host.setStatus(t("status.deleteUnavailable"));
		return;
	}
	const targets = rows.filter((row) => findSessionIndex([row], host.currentSessionFile) !== 0);
	if (targets.length === 0) {
		const active = rows.find((row) => findSessionIndex([row], host.currentSessionFile) === 0);
		openCannotDeleteAlert(host, active);
		return;
	}
	const skipped = rows.length - targets.length;
	host.openMenu(
		"confirm",
		confirmDialogSpec({
			title: targets.length === 1 && rows.length === 1 ? deleteSessionTitle() : deleteSessionsTitle(targets.length),
			// 数量已经在标题里；只提示“当前会话被跳过”。
			...(skipped ? { subject: t("confirm.deleteSkipped") } : targets.length === 1 ? { subject: sessionSubject(targets[0]!) } : {}),
			onConfirm: () => void deleteArchivedSessions(host, targets),
			onCancel: () => host.closeDialogs(),
		}),
	);
}

/** Warn (in a box, not just the footer) that the session pi has open can't be deleted. */
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

/** Yes on the archive deletion confirmation: delete one by one, refresh the dialog and report. */
async function deleteArchivedSessions(host: FlowHost, targets: readonly SessionRow[]): Promise<void> {
	host.closeDialogs();
	const remove = host.actions?.deleteSession;
	if (!remove || targets.length === 0) return;
	host.setStatus(t("status.deletingN", { count: targets.length }));
	let deleted = 0;
	let firstError: string | undefined;
	const removed: string[] = [];
	const methods: DeleteMethod[] = [];
	for (const row of targets) {
		try {
			methods.push(await remove(row.file));
			deleted++;
			removed.push(row.file);
		} catch (err) {
			firstError ??= `${sessionTitle(row) || t("pane.emptySession")}: ${(err as Error).message}`;
		}
		if (host.isDisposed()) return;
	}
	const warning = await forgetDeletedSessions(host, removed);
	if (host.isDisposed()) return;
	// 删除成功的行直接本地移除；失败的仍留在框里。
	host.removeArchivedRows(removed);
	const failed = targets.length - deleted;
	const summary = targets.length === 1
		? failed
			? t("status.deleteFailed", { error: firstError })
			: methods[0] === "trash" ? t("status.movedToTrash") : t("status.deleted")
		: failed
			? t("status.batchDeletedFailed", { deleted, failed, error: firstError })
			: t("status.sessionsDeleted", { count: deleted });
	host.setStatus([summary, warning].filter(Boolean).join(" — "));
}

/** JSONL deletion already succeeded. Metadata failure must be reported separately, not as a failed delete. */
export async function forgetDeletedSessions(host: FlowHost, files: readonly string[]): Promise<string | undefined> {
	if (!files.length || !host.actions?.updateSessionState) return undefined;
	try {
		const saved = await host.actions.updateSessionState({ type: "delete", files });
		if (!host.isDisposed()) applySessionFileState(host.state, saved);
		return saved.warning ? t("status.sessionStateSavedWarning", { error: saved.warning }) : undefined;
	} catch (err) {
		return t("status.sessionStateCleanupFailed", { error: (err as Error).message });
	}
}
