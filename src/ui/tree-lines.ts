/**
 * Tree guide lines, drawn the way pi's own `/tree` selector draws them:
 *
 *    [system]
 *   ├⊟ [hello] user: hi
 *   │     assistant: Hello!
 *   ├⊞ user: hi                      (folded: its descendants are not listed)
 *   └─ [branch summary]: …
 *
 * Pure functions over `TreeRow[]` (pre-order, linked by `parentId`); used by
 * the full tree dialog (the small pane draws the lighter outline of
 * ./tree-outline.ts instead). Rules copied from pi (`tree-selector.js`
 * flattenTree):
 *   - a node whose parent has several children gets a connector (├ / └)
 *   - the indent grows by one level at a branch point and once more for the
 *     first generation after it; a single-child chain stays at the same level
 *   - descendants of a connector row carry a `│` gutter in that column while
 *     later siblings follow, a blank column once the last sibling started
 *   - `⊟` on the connector marks a node that has children, `─` a leaf and `⊞`
 *     a folded node (see ../data/tree-fold.ts); a folded root without a
 *     connector gets a `⊞ ` marker after its prefix, as in pi
 * Every level is 3 columns wide.
 *
 * 树线的计算和 pi 的 /tree 一致；这里只产出前缀字符串，配色由调用方决定。
 */

import { treeChildren } from "../data/tree-fold.ts";
import type { TreeRow } from "../types.ts";

/** One `│` (or blank) column carried by descendants of a connector row. */
interface Gutter {
	position: number;
	show: boolean;
}

/**
 * Guide-line prefix of every row, aligned with `rows`. Rows whose `parentId`
 * does not name a row are treated as roots. `folded` rows are drawn with `⊞`
 * (their descendants are expected to be missing from `rows` already).
 */
export function treePrefixes(rows: TreeRow[], folded: ReadonlySet<string> = new Set()): string[] {
	const children = treeChildren(rows);
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
		// 只有分支段的起点（showConnector）才可能被折叠；多根时的根没有连接符，折叠标记跟在前缀后面。
		const isFolded = f.showConnector && folded.has(f.row.entryId);
		const prefix = buildPrefix(displayIndent, connector ? displayIndent - 1 : -1, f.isLast, kids.length > 0, isFolded, f.gutters);
		out.set(f.row.entryId, isFolded && !connector ? `${prefix}⊞ ` : prefix);

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

function buildPrefix(levels: number, connectorLevel: number, isLast: boolean, hasChildren: boolean, isFolded: boolean, gutters: Gutter[]): string {
	const chars: string[] = [];
	for (let level = 0; level < levels; level++) {
		const gutter = gutters.find((g) => g.position === level);
		if (gutter) {
			chars.push(gutter.show ? "│" : " ", " ", " ");
		} else if (level === connectorLevel) {
			chars.push(isLast ? "└" : "├", isFolded ? "⊞" : hasChildren ? "⊟" : "─", " ");
		} else {
			chars.push(" ", " ", " ");
		}
	}
	return chars.join("");
}
