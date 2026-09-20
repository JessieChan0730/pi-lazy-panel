/**
 * Sessions data adapter.
 *
 * Read-only bridge between pi's `SessionManager.list()` / `listAll()` and the
 * `SessionRow` shape used by the sessions pane. No UI code here.
 *
 * TODO: implement listSessions(), sortSessions().
 */

import type { ListScope, SessionRow, SessionSortMode } from "../types.ts";

export interface ListSessionsOptions {
	cwd: string;
	scope: ListScope;
}

/** List sessions for the given scope. */
export async function listSessions(_options: ListSessionsOptions): Promise<SessionRow[]> {
	// TODO: SessionManager.list(cwd) | SessionManager.listAll() -> SessionRow[]
	return [];
}

/** Return a sorted copy of the rows. */
export function sortSessions(rows: SessionRow[], _mode: SessionSortMode): SessionRow[] {
	// TODO: threaded (group by parent), recent (updatedAt desc), fuzzy (by query score)
	return [...rows];
}
