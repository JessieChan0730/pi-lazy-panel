/**
 * Pure mouse hit-testing for the panel. Maps a terminal cell (x, y) to the pane
 * under it and, for the two list panes, the row index the cell falls on.
 *
 * The geometry MUST match LazyPanel.render(): the panel calls `panelGeometry()`
 * from both places, so a layout tweak can never desync clicks from what is
 * drawn. No I/O, no pi APIs — just arithmetic, tested in test/ui.test.ts.
 */

import { LEFT_COLUMN_RATIO } from "../constants.ts";
import type { PaneId } from "../types.ts";
import { SESSIONS_ROW_HEIGHT } from "./panes/sessions-pane.ts";

export interface VerticalSplit {
	/** Rows of the body above the one-line footer. */
	bodyH: number;
	/** Rows of the (top) sessions pane; the tree pane takes the rest of the left column. */
	sessionsH: number;
	treeH: number;
}

/** The body / sessions / tree row split for `height` rows (independent of width). */
export function verticalSplit(height: number): VerticalSplit {
	const bodyH = height - 1; // footer 占最后一行
	const sessionsH = Math.max(4, Math.floor(bodyH / 2));
	return { bodyH, sessionsH, treeH: bodyH - sessionsH };
}

export interface PanelGeometry extends VerticalSplit {
	/** Width of the left column (sessions + tree); the right column takes the rest. */
	leftW: number;
	rightW: number;
}

/**
 * The panel's column / row split for a `width` × `height` viewport. Shared with
 * `LazyPanel.render()` so the drawn layout and the mouse hit-test never diverge.
 */
export function panelGeometry(width: number, height: number, ratio: number = LEFT_COLUMN_RATIO): PanelGeometry {
	const v = verticalSplit(height);
	const leftW = Math.max(24, Math.min(width - 30, Math.floor(width * ratio)));
	return { ...v, leftW, rightW: width - leftW };
}

/** Visible list rows in each left pane for `height` rows (sessions take 2 lines per row, tree 1). */
export function listVisibleRows(height: number): { sessions: number; tree: number } {
	const { sessionsH, treeH } = verticalSplit(height);
	return { sessions: Math.max(1, Math.floor((sessionsH - 2) / SESSIONS_ROW_HEIGHT)), tree: Math.max(1, treeH - 2) };
}

/** Pane under the pointer; list panes also carry the row hit (undefined on a border / blank cell). */
export type MouseTarget = { pane: PaneId; row: number | undefined };

export interface HitInput {
	width: number;
	height: number;
	ratio: number;
	/** Cell local to the panel (top-left overlay, so this equals the screen cell). */
	x: number;
	y: number;
	/** First visible row of each list pane (the offset render actually used). */
	sessionsFirst: number;
	sessionsTotal: number;
	treeFirst: number;
	treeTotal: number;
}

/**
 * Which pane the cell (x, y) is over, and for a list pane the row index it hits
 * (undefined when it lands on a border or a blank area past the last row).
 * Returns undefined for the footer row or anything outside the body.
 */
export function hitTest(i: HitInput): MouseTarget | undefined {
	const g = panelGeometry(i.width, i.height, i.ratio);
	if (i.y < 0 || i.y >= g.bodyH || i.x < 0 || i.x >= i.width) return undefined; // 页脚 / 面板之外
	// 右侧 CONTENT 面板占满 body 高度，只切焦点、不选行。
	if (i.x >= g.leftW) return { pane: "content", row: undefined };
	if (i.y < g.sessionsH) {
		return { pane: "sessions", row: listRow(i.y, g.sessionsH, SESSIONS_ROW_HEIGHT, i.sessionsFirst, i.sessionsTotal) };
	}
	return { pane: "tree", row: listRow(i.y - g.sessionsH, g.treeH, 1, i.treeFirst, i.treeTotal) };
}

/**
 * Row index a cell at pane-local `y` (0 = the pane's top border) hits inside a
 * framed list pane whose first visible row is `first`, or undefined for the
 * border rows / a cell past the last row. `rowHeight` is the lines per item
 * (2 for sessions, 1 for tree).
 */
function listRow(y: number, paneH: number, rowHeight: number, first: number, total: number): number | undefined {
	const bodyRows = paneH - 2; // 去掉上下边框
	const bodyY = y - 1; // 第一行是上边框
	if (bodyY < 0 || bodyY >= bodyRows) return undefined;
	const visible = Math.max(1, Math.floor(bodyRows / rowHeight));
	const within = Math.floor(bodyY / rowHeight);
	if (within >= visible) return undefined; // 底部不足一整行的空白行
	const index = first + within;
	return index >= 0 && index < total ? index : undefined;
}
