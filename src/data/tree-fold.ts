/**
 * Folding of tree rows (the `z` key of the tree pane, `⊞` in the tree dialog).
 *
 * The unit of folding is a branch segment, as in pi's own /tree: a row can be
 * folded when it starts a segment — its parent has several children, or it is
 * one of several roots — and it has children of its own. Folding hides every
 * descendant. Unlike pi, a lone root is not foldable (that would hide the whole
 * tree), so a linear conversation has nothing to fold and nothing to mark.
 *
 * Pure functions over pre-order `TreeRow[]` (parents precede children, see
 * ./tree.ts); the panel keeps the folded ids in its state, the pane and the
 * dialog only ever see the rows that survive `applyTreeFold`.
 *
 * 折叠的单位是"分支段"：父节点有多个子节点的那个子节点（或多根时的根）且自己有后代
 * 才能折叠，折叠后隐藏它的全部后代。默认把不在活动分支上的段都折起来。
 */

import type { TreeRow } from "../types.ts";

/** Children of every row keyed by parent id (`undefined` = roots), in row order. A parent that is not a row counts as none. */
export function treeChildren(rows: TreeRow[]): Map<string | undefined, TreeRow[]> {
	const ids = new Set(rows.map((r) => r.entryId));
	const children = new Map<string | undefined, TreeRow[]>();
	for (const r of rows) {
		const key = r.parentId !== undefined && ids.has(r.parentId) ? r.parentId : undefined;
		const list = children.get(key);
		if (list) list.push(r);
		else children.set(key, [r]);
	}
	return children;
}

/** Rows that start a branch segment: children of a node with several children, or the roots when there are several. */
export function forkChildIds(rows: TreeRow[], children = treeChildren(rows)): Set<string> {
	const out = new Set<string>();
	for (const kids of children.values()) {
		if (kids.length > 1) for (const k of kids) out.add(k.entryId);
	}
	return out;
}

/** Segment starts that have descendants — the rows `z` can fold. */
export function foldableIds(rows: TreeRow[]): Set<string> {
	const children = treeChildren(rows);
	const out = new Set<string>();
	for (const id of forkChildIds(rows, children)) {
		if (children.get(id)?.length) out.add(id);
	}
	return out;
}

/** Fold state a freshly loaded tree opens with: every foldable row off the active branch. */
export function defaultFolded(rows: TreeRow[]): Set<string> {
	const foldable = foldableIds(rows);
	const out = new Set<string>();
	for (const r of rows) {
		if (foldable.has(r.entryId) && !r.onActiveBranch) out.add(r.entryId);
	}
	return out;
}

/**
 * Rows still shown once the descendants of every folded row are hidden. Ids in
 * `folded` that are not foldable (stale after a reload) are ignored.
 */
export function applyTreeFold(rows: TreeRow[], folded: ReadonlySet<string>): TreeRow[] {
	if (folded.size === 0) return rows;
	const foldable = foldableIds(rows);
	const hidden = new Set<string>();
	const out: TreeRow[] = [];
	// rows 是先序的：父节点先出现，所以看父节点是否被折叠 / 已隐藏就能一遍算完。
	for (const r of rows) {
		const parent = r.parentId;
		if (parent !== undefined && (hidden.has(parent) || (folded.has(parent) && foldable.has(parent)))) {
			hidden.add(r.entryId);
			continue;
		}
		out.push(r);
	}
	return out;
}

/**
 * Row `z` acts on when the cursor is on `entryId`: the row itself when it is
 * foldable, otherwise the nearest foldable ancestor (the head of the segment
 * the row is in); `undefined` on the trunk of a single-root tree, where nothing
 * folds.
 */
export function foldTarget(rows: TreeRow[], entryId: string): string | undefined {
	const foldable = foldableIds(rows);
	const parents = new Map(rows.map((r) => [r.entryId, r.parentId]));
	let id: string | undefined = entryId;
	while (id !== undefined && parents.has(id)) {
		if (foldable.has(id)) return id;
		id = parents.get(id);
	}
	return undefined;
}
