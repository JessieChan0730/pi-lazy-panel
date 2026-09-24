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
import { SESSIONS_ROW_HEIGHT, scrollOffset } from "./panes/sessions-pane.ts";

export interface PanelGeometry {
	/** Width of the left column (sessions + tree); the right column takes the rest. */
	leftW: number;
	rightW: number;
	/** Rows of the body above the one-line footer. */
	bodyH: number;
	/** Rows of the (top) sessions pane; the tree pane takes the rest of the left column. */
	sessionsH: number;
	treeH: number;
}

/**
 * The panel's column / row split for a `width` × `height` viewport. Shared with
 * `LazyPanel.render()` so the drawn layout and the mouse hit-test never diverge.
 */
export function panelGeometry(width: number, height: number, ratio: number = LEFT_COLUMN_RATIO): PanelGeometry {
	const bodyH = height - 1; // footer 占最后一行
	const leftW = Math.max(24, Math.min(width - 30, Math.floor(width * ratio)));
	const sessionsH = Math.max(4, Math.floor(bodyH / 2));
	return { leftW, rightW: width - leftW, bodyH, sessionsH, treeH: bodyH - sessionsH };
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
	sessionsCursor: number;
	sessionsTotal: number;
	treeCursor: number;
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
		return { pane: "sessions", row: listRow(i.y, g.sessionsH, SESSIONS_ROW_HEIGHT, i.sessionsCursor, i.sessionsTotal) };
	}
	return { pane: "tree", row: listRow(i.y - g.sessionsH, g.treeH, 1, i.treeCursor, i.treeTotal) };
}

/**
 * Row index a cell at pane-local `y` (0 = the pane's top border) hits inside a
 * framed list pane, or undefined for the border rows / a cell past the last row.
 * `rowHeight` is the lines per item (2 for sessions, 1 for tree); the window is
 * recomputed from the cursor exactly as the panes do, so clicks match the draw.
 */
function listRow(y: number, paneH: number, rowHeight: number, cursor: number, total: number): number | undefined {
	const bodyRows = paneH - 2; // 去掉上下边框
	const bodyY = y - 1; // 第一行是上边框
	if (bodyY < 0 || bodyY >= bodyRows) return undefined;
	const visible = Math.max(1, Math.floor(bodyRows / rowHeight));
	const within = Math.floor(bodyY / rowHeight);
	if (within >= visible) return undefined; // 底部不足一整行的空白行
	const index = scrollOffset(cursor, total, visible) + within;
	return index >= 0 && index < total ? index : undefined;
}
