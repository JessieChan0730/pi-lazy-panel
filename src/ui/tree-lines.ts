/**
 * Tree guide lines, drawn the way pi's own `/tree` selector draws them:
 *
 *    [system]
 *   ├⊟ [hello] user: hi
 *   │     assistant: Hello!
 *   ├⊟ user: hi
 *   │  ├⊟ user: again
 *   │  │     assistant: …
 *   │  └─ user: last
 *   └─ [branch summary]: …
 *
 * Pure functions over `TreeRow[]` (pre-order, linked by `parentId`); shared by
 * the small tree pane and the full tree dialog. Rules copied from pi
 * (`tree-selector.js` flattenTree):
 *   - a node whose parent has several children gets a connector (├ / └)
 *   - the indent grows by one level at a branch point and once more for the
 *     first generation after it; a single-child chain stays at the same level
 *   - descendants of a connector row carry a `│` gutter in that column while
 *     later siblings follow, a blank column once the last sibling started
 *   - `⊟` on the connector marks a node that has children, `─` a leaf
 * Every level is 3 columns wide.
 *
 * 树线的计算和 pi 的 /tree 一致；这里只产出前缀字符串，配色由调用方决定。
 */

import type { TreeRow } from "../types.ts";

/** Columns per indent level ("├⊟ " / "│  "). */
export const LEVEL_WIDTH = 3;

/** Marks dropped levels when a prefix is capped with `capPrefix`. */
export const ELLIPSIS_PREFIX = "… ";

/** One `│` (or blank) column carried by descendants of a connector row. */
interface Gutter {
	position: number;
	show: boolean;
}

/**
 * Guide-line prefix of every row, aligned with `rows`. Rows whose `parentId`
 * does not name an earlier row are treated as roots.
 */
export function treePrefixes(rows: TreeRow[]): string[] {
	const children = new Map<string | undefined, TreeRow[]>();
	const ids = new Set(rows.map((r) => r.entryId));
	for (const r of rows) {
		const key = r.parentId !== undefined && ids.has(r.parentId) ? r.parentId : undefined;
		const list = children.get(key);
		if (list) list.push(r);
		else children.set(key, [r]);
	}
	const roots = children.get(undefined) ?? [];
	const multipleRoots = roots.length > 1;
	const out = new Map<string, string>();

	// 和 pi 一样用显式栈做先序遍历，避免深树递归爆栈。
	interface Frame {
		row: TreeRow;
		indent: number;
		justBranched: boolean;
		showConnector: boolean;
		isLast: boolean;
		gutters: Gutter[];
		isVirtualRootChild: boolean;
	}
	const stack: Frame[] = [];
	for (let i = roots.length - 1; i >= 0; i--) {
		stack.push({
			row: roots[i]!,
			indent: multipleRoots ? 1 : 0,
			justBranched: multipleRoots,
			showConnector: multipleRoots,
			isLast: i === roots.length - 1,
			gutters: [],
			isVirtualRootChild: multipleRoots,
		});
	}
	while (stack.length) {
		const f = stack.pop()!;
		const kids = children.get(f.row.entryId) ?? [];
		const displayIndent = multipleRoots ? Math.max(0, f.indent - 1) : f.indent;
		const connector = f.showConnector && !f.isVirtualRootChild;
		out.set(f.row.entryId, buildPrefix(displayIndent, connector ? displayIndent - 1 : -1, f.isLast, kids.length > 0, f.gutters));

		const multipleChildren = kids.length > 1;
		// 分叉处子节点缩进 +1；分叉后的第一代再 +1 做视觉分组；单链不缩进。
		const childIndent = multipleChildren || (f.justBranched && f.indent > 0) ? f.indent + 1 : f.indent;
		const childGutters = connector ? [...f.gutters, { position: Math.max(0, displayIndent - 1), show: !f.isLast }] : f.gutters;
		for (let i = kids.length - 1; i >= 0; i--) {
			stack.push({
				row: kids[i]!,
				indent: childIndent,
				justBranched: multipleChildren,
				showConnector: multipleChildren,
				isLast: i === kids.length - 1,
				gutters: childGutters,
				isVirtualRootChild: false,
			});
		}
	}
	return rows.map((r) => out.get(r.entryId) ?? "");
}

function buildPrefix(levels: number, connectorLevel: number, isLast: boolean, hasChildren: boolean, gutters: Gutter[]): string {
	const chars: string[] = [];
	for (let level = 0; level < levels; level++) {
		const gutter = gutters.find((g) => g.position === level);
		if (gutter) {
			chars.push(gutter.show ? "│" : " ", " ", " ");
		} else if (level === connectorLevel) {
			chars.push(isLast ? "└" : "├", hasChildren ? "⊟" : "─", " ");
		} else {
			chars.push(" ", " ", " ");
		}
	}
	return chars.join("");
}

/**
 * Keep only the innermost `maxLevels` levels of a prefix and mark the dropped
 * ones with `… `, so a deep tree still fits the narrow tree pane:
 *
 *   "│  │  │  ├─ "  (4 levels, max 2)  ->  "… │  ├─ "
 */
export function capPrefix(prefix: string, maxLevels: number): string {
	const levels = Math.floor([...prefix].length / LEVEL_WIDTH);
	if (levels <= maxLevels) return prefix;
	const kept = [...prefix].slice((levels - maxLevels) * LEVEL_WIDTH).join("");
	return ELLIPSIS_PREFIX + kept;
}
