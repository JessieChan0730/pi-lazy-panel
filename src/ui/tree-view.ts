/**
 * The TREE pane's rows: the whole (filtered) tree of the loaded session, the
 * rows the pane lists once folded branch segments are hidden, and their
 * outline prefixes — plus the fold operations that keep the three in step.
 * The tree dialog shares the same folds (and suspends them while it
 * searches, like pi's /tree).
 *
 * The fold set and the cursor stay in `PanelState` (`treeFolded` /
 * `cursor.tree`, an index into the visible rows); this class derives the
 * rest and keeps the rules for moving them. Following the cursor with the
 * content pane is the panel's job.
 *
 * TREE 面板的行：整棵树、折叠后可见的行、大纲前缀，以及让三者保持一致的折叠操作。
 * 折叠状态和光标仍然放在 PanelState 里。
 */

import { applyTreeFold, foldedAncestors, foldTarget } from "../data/tree-fold.ts";
import type { TreeRow } from "../types.ts";
import { clamp } from "../utils/indices.ts";
import type { PanelState } from "./state.ts";
import { type OutlinePrefix, treeOutline } from "./tree-outline.ts";

export class TreeView {
	private _rows: TreeRow[] = [];
	private _visible: TreeRow[] = [];
	private _outline: ReadonlyMap<string, OutlinePrefix> = new Map();
	/**
	 * Fold state from before the tree dialog's search started: a search shows
	 * every match, so the folds are cleared meanwhile and restored when the
	 * query is gone (or the dialog closes).
	 */
	private suspended: Set<string> | undefined;

	/** `state`: the view reads and writes `treeFolded` and `cursor.tree`. */
	constructor(private readonly state: PanelState) {}

	/** The whole (filtered) tree, folded rows included: what `/` searches and the dialog narrows. */
	get rows(): TreeRow[] {
		return this._rows;
	}

	/** What the pane lists: the tree with folded segments hidden (`cursor.tree` indexes these). */
	get visible(): TreeRow[] {
		return this._visible;
	}

	/** Outline prefix per visible row. */
	get outline(): ReadonlyMap<string, OutlinePrefix> {
		return this._outline;
	}

	/** Replace the tree and its fold state. */
	set(rows: TreeRow[], folded: Set<string>): void {
		this._rows = rows;
		this.state.treeFolded = folded;
		this.refresh();
	}

	/** 折叠状态变了 / 树重新加载后：重新算可见行和大纲前缀（光标索引指向可见行）。 */
	refresh(): void {
		this._visible = applyTreeFold(this._rows, this.state.treeFolded);
		this._outline = treeOutline(this._rows, this.state.treeFolded);
	}

	/** The row under the cursor. */
	cursorRow(): TreeRow | undefined {
		return this._visible[this.state.cursor.tree];
	}

	/** Index in the whole tree of the cursor row (search matches count rows of the whole tree), -1 with no rows. */
	cursorTreeIndex(): number {
		const row = this.cursorRow();
		return row ? this._rows.findIndex((r) => r.entryId === row.entryId) : -1;
	}

	/** Visible row index of `entryId`, -1 when it is folded away or not in the tree. */
	indexOf(entryId: string | undefined): number {
		return entryId ? this._visible.findIndex((r) => r.entryId === entryId) : -1;
	}

	/** `index` clamped into the visible rows. */
	clampIndex(index: number): number {
		return clamp(index, 0, Math.max(0, this._visible.length - 1));
	}

	/** Put the cursor on `entryId`; when that row is not listed the cursor stays where it is, clamped. */
	keepCursorOn(entryId: string | undefined): void {
		const idx = this.indexOf(entryId);
		this.state.cursor.tree = idx >= 0 ? idx : this.clampIndex(this.state.cursor.tree);
	}

	/** Unfold whatever hides `entryId`, then refresh. */
	reveal(entryId: string): void {
		for (const id of foldedAncestors(this._rows, entryId, this.state.treeFolded)) this.state.treeFolded.delete(id);
		this.refresh();
	}

	/**
	 * z: toggle the fold of the segment `entryId` is in, looked up in `base`
	 * (the whole tree, or the dialog's search-narrowed rows). On a segment head
	 * the fold toggles; anywhere inside a segment that segment folds. Returns
	 * the head the cursor should land on, or undefined on the trunk, where
	 * nothing folds. The caller refreshes.
	 */
	toggleFold(base: TreeRow[], entryId: string): string | undefined {
		const target = foldTarget(base, entryId);
		if (!target) return undefined;
		const folded = this.state.treeFolded;
		// 光标在段头上：切换；在段内其他行：折叠所在段（此时这一段一定是展开的）。
		if (target === entryId && folded.has(target)) folded.delete(target);
		else folded.add(target);
		return target;
	}

	/** The dialog's search changed: clear the folds, remembering them the first time. The caller refreshes. */
	suspendFolds(): void {
		// 第一次开始搜索时记住原来的折叠状态；之后每次改动查询都重新清空（pi 的做法）。
		this.suspended ??= new Set(this.state.treeFolded);
		this.state.treeFolded.clear();
	}

	/** The search is over: bring back the folds from before it, if any were suspended. The caller refreshes. */
	resumeFolds(): void {
		if (!this.suspended) return;
		this.state.treeFolded = this.suspended;
		this.suspended = undefined;
	}

	/** Forget suspended folds (a new dialog, or a reload that made them stale). */
	dropSuspendedFolds(): void {
		this.suspended = undefined;
	}
}
