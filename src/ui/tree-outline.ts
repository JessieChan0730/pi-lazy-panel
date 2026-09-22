/**
 * Outline prefixes of the tree pane: a triangle on the rows that can fold and
 * plain indentation below them — the lightweight cousin of the guide lines in
 * ./tree-lines.ts, which the tree dialog keeps. Drawn like lazygit's file
 * tree: the marker of a branch sits where its siblings' text starts and the
 * rows inside the branch line up under the branch's own text.
 *
 *   › • 22:18 [system]              depth 0: a lone root is not a branch, nothing in front of it
 *     • 22:18 user: hi
 *     • 22:19 assistant: …          (branch point)
 *     ▸ 22:20 user: try again       folded side branch, its rows are hidden
 *     ▾ • 22:21 [system]            open branch on the active path
 *       • 22:21 user: hi            rows inside it sit one level (2 columns) deeper, under the branch's text
 *       ─ 22:22 [branch summary]    dead-end sibling: no children, nothing to fold
 *       ▾ • 22:22 user: hi
 *         • 22:22 assistant: …
 *
 * Rules (pure functions over pre-order `TreeRow[]`; which rows fold is decided
 * in ../data/tree-fold.ts):
 *   - depth grows by one below every foldable row; a chain and a dead end stay
 *     at their parent's depth, so a linear conversation is completely flat
 *   - every level is 2 columns of indent; only a segment start carries a
 *     marker (`▾ ` open, `▸ ` folded, `─ ` no children), which pushes its own
 *     text 2 columns right — exactly where the rows inside it start
 *   - past MAX_DEPTH the outer levels are replaced by `… `, so the prefix never
 *     grows beyond four levels
 *
 * 面板用三角 + 缩进代替树线；只在段头下面多缩进一层，线性对话完全不缩进。
 */

import { foldableIds, forkChildIds, treeChildren } from "../data/tree-fold.ts";
import type { TreeRow } from "../types.ts";

/** Columns per depth level. */
export const INDENT = "  ";

/** Depths 0..MAX_DEPTH are drawn as they are (four levels); deeper rows are capped with `… `. */
export const MAX_DEPTH = 3;

/** Replaces the outer levels of a row deeper than MAX_DEPTH. */
export const ELLIPSIS = "… ";

export const MARK_OPEN = "▾ ";
export const MARK_FOLDED = "▸ ";
/** A segment start without children: an alternative that was never continued. */
export const MARK_LEAF = "─ ";

export interface OutlinePrefix {
	/** Indentation: `INDENT` per level, `… ` standing in for the outer levels past MAX_DEPTH. */
	indent: string;
	/** Fold marker of a segment start, "" on every other row. */
	marker: string;
}

/**
 * Outline prefix of every row keyed by entry id, computed over the whole tree
 * (not just the rows left after folding) so nothing shifts when a branch
 * folds; `folded` picks `▸ ` over `▾ `.
 */
export function treeOutline(rows: TreeRow[], folded: ReadonlySet<string>, maxDepth = MAX_DEPTH): Map<string, OutlinePrefix> {
	const children = treeChildren(rows);
	const forkChildren = forkChildIds(rows, children);
	const foldable = foldableIds(rows);
	const depths = new Map<string, number>();
	const out = new Map<string, OutlinePrefix>();
	// 先序：父节点的深度已经算好；父节点可折叠时子节点深一层，否则同层。
	for (const r of rows) {
		const parentDepth = r.parentId !== undefined ? depths.get(r.parentId) : undefined;
		const depth = parentDepth === undefined ? 0 : parentDepth + (foldable.has(r.parentId!) ? 1 : 0);
		depths.set(r.entryId, depth);
		const capped = depth > maxDepth;
		const indent = (capped ? ELLIPSIS : "") + INDENT.repeat(capped ? Math.max(0, maxDepth - 1) : depth);
		let marker = "";
		if (forkChildren.has(r.entryId)) {
			marker = !children.get(r.entryId)?.length ? MARK_LEAF : folded.has(r.entryId) ? MARK_FOLDED : MARK_OPEN;
		}
		out.set(r.entryId, { indent, marker });
	}
	return out;
}
