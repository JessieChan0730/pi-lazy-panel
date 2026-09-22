/**
 * Sessions data adapter.
 *
 * Read-only bridge between pi's `SessionManager.list()` / `listAll()` and the
 * `SessionRow` shape used by the sessions pane. No UI code here.
 */

import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ListScope, SessionRow, SessionSortMode } from "../types.ts";
import { singleLine } from "../utils/format.ts";

export interface ListSessionsOptions {
	cwd: string;
	scope: ListScope;
}

/** List sessions for the given scope. */
export async function listSessions(options: ListSessionsOptions): Promise<SessionRow[]> {
	const infos =
		options.scope === "all" ? await SessionManager.listAll() : await SessionManager.list(options.cwd);

	return infos.map((info) => {
		const row: SessionRow = {
			file: info.path,
			id: info.id,
			cwd: info.cwd,
			preview: singleLine(info.firstMessage),
			createdAt: info.created.getTime(),
			updatedAt: info.modified.getTime(),
			messageCount: info.messageCount,
		};
		if (info.name) row.name = info.name;
		if (info.parentSessionPath) row.parentFile = info.parentSessionPath;
		const model = readLastModel(info.path);
		if (model) row.model = model;
		return row;
	});
}

/**
 * Model id of the last `model_change` entry in the session file, if any.
 * `SessionInfo` does not carry it, so we do one cheap read of the file.
 */
function readLastModel(file: string): string | undefined {
	try {
		const manager = SessionManager.open(file);
		let model: string | undefined;
		for (const entry of manager.getEntries()) {
			if (entry.type === "model_change") model = entry.modelId;
		}
		return model;
	} catch {
		return undefined;
	}
}

/**
 * Index of the row whose file is `sessionFile` (paths compared after `resolve`,
 * same rule as `isCurrentSession`), or -1. Used to put the cursor on pi's
 * current session when the panel opens.
 */
export function findSessionIndex(rows: SessionRow[], sessionFile: string | undefined): number {
	if (!sessionFile) return -1;
	const target = resolve(sessionFile);
	return rows.findIndex((row) => resolve(row.file) === target);
}

/** Return a sorted copy of the rows. */
export function sortSessions(rows: SessionRow[], mode: SessionSortMode): SessionRow[] {
	const byRecent = (a: SessionRow, b: SessionRow) => b.updatedAt - a.updatedAt;
	switch (mode) {
		case "recent":
		case "fuzzy":
			// Fuzzy ordering only differs once a query is active (task for a later step).
			return [...rows].sort(byRecent);
		case "threaded":
			return sortThreaded(rows, byRecent);
	}
}

/**
 * Threaded: roots ordered by recency, each followed (depth-first) by the
 * sessions forked from it. Rows whose parent is unknown are treated as roots.
 */
function sortThreaded(rows: SessionRow[], cmp: (a: SessionRow, b: SessionRow) => number): SessionRow[] {
	const byFile = new Map(rows.map((r) => [r.file, r]));
	const children = new Map<string, SessionRow[]>();
	const roots: SessionRow[] = [];
	for (const row of rows) {
		const parent = row.parentFile;
		if (parent && byFile.has(parent) && parent !== row.file) {
			const list = children.get(parent) ?? [];
			list.push(row);
			children.set(parent, list);
		} else {
			roots.push(row);
		}
	}
	const out: SessionRow[] = [];
	const seen = new Set<string>();
	const visit = (row: SessionRow, depth: number) => {
		if (seen.has(row.file)) return;
		seen.add(row.file);
		out.push({ ...row, threadDepth: depth });
		for (const child of (children.get(row.file) ?? []).sort(cmp)) visit(child, depth + 1);
	};
	for (const root of roots.sort(cmp)) visit(root, 0);
	// Defensive: rows in a parent cycle never became reachable from a root.
	for (const row of rows.sort(cmp)) visit(row, 0);
	return out;
}
