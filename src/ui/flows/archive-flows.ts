/** Session organization flows: explicit file targets, atomic persistence, then refresh. */
import { t } from "../../i18n/index.ts";
import type { SessionFileChange } from "../../types.ts";
import { sessionFileKey } from "../../utils/session-file-key.ts";
import { applySessionFileState } from "../state.ts";
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

/** x archives in the normal view and unarchives in the archive view; never touches JSONL. */
export async function toggleArchive(host: FlowHost): Promise<void> {
	if (host.state.sessionStateBusy) return;
	if (!host.actions?.updateSessionState) {
		host.setStatus(t("status.archiveUnavailable"));
		return;
	}
	const files = targetsFor(host);
	if (!files.length) return;
	const archiving = host.state.sessionView === "normal";
	const status = archiving
		? t("status.sessionsArchived", { count: files.length, hint: host.archiveViewHint() })
		: t("status.sessionsUnarchived", { count: files.length });
	await changeSessionFiles(host, { type: archiving ? "archive" : "unarchive", files }, neighbourAfterRemoving(host, files), status);
}

/** p: if any target is unpinned, pin the group; otherwise unpin it. */
export async function togglePin(host: FlowHost): Promise<void> {
	if (host.state.sessionStateBusy) return;
	if (host.state.sessionView === "archived") {
		host.setStatus(t("status.unarchiveBeforePin"));
		return;
	}
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
