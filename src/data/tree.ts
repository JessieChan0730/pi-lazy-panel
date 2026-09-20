/**
 * Tree data adapter.
 *
 * Builds `TreeRow[]` for a selected session by walking its entry tree
 * (mirrors what pi's `/tree` shows). No UI code here.
 *
 * TODO: implement loadTree(), applyTreeFilter().
 */

import type { TreeFilter, TreeRow } from "../types.ts";

/** Load the entry tree for a session file. */
export async function loadTree(_sessionFile: string): Promise<TreeRow[]> {
	// TODO: open a SessionManager on the file, getTree(), flatten to rows with depth
	return [];
}

/** Filter tree rows (mirrors /tree ctrl+d/t/u/l/a). */
export function applyTreeFilter(rows: TreeRow[], _filter: TreeFilter): TreeRow[] {
	// TODO
	return rows;
}
