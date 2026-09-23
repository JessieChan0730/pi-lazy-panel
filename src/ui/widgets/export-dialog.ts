/**
 * Export dialogs (`e` in the sessions pane, what pi's `/export` does): the
 * format menu and the output-path prompt.
 *
 *   ┌─ Export as ─────────────────────────── FilmRecall ─┐
 *   │ › HTML   whole tree, opens in a browser             │
 *   │   JSONL  active branch, can be imported again        │
 *   └──────────────────────────────────────────────────────┘
 *   ┌─ Export to ──────────────────────────── FilmRecall ─┐
 *   │ E:\work\pi-session-2026-09-23T….html                 │
 *   └──────────────────────────────────────────────────────┘
 *
 * Only wording for a ./select-dialog.ts and an ./input-dialog.ts preset, like
 * ./restore-dialog.ts. The path is pre-filled with pi's default (the actions
 * layer resolves it); a directory gets the default file name inside it, and an
 * existing file is confirmed (./confirm-dialog.ts) before it is overwritten.
 *
 * 导出只是两个通用弹窗的预设：先选格式（SelectDialog），再输入输出路径（InputDialog，
 * 预填 pi 的默认路径，Esc 退回格式菜单）。目标文件已存在时再弹确认框。
 */

import type { ExportFormat, KeyHint } from "../../types.ts";

/** Title of the format menu. */
export const EXPORT_FORMAT_TITLE = "Export as";

/** Menu entries, top to bottom (HTML first, like /export without an extension). */
export const EXPORT_FORMATS: ReadonlyArray<{ format: ExportFormat; label: string }> = [
	{ format: "html", label: "HTML   whole tree, opens in a browser" },
	{ format: "jsonl", label: "JSONL  active branch, can be imported again" },
];

/** Footer hints while the format menu is open. */
export const EXPORT_FORMAT_HINTS: KeyHint[] = [
	["j/k", "move"],
	["Enter", "select"],
	["Esc", "cancel"],
];

/** Title of the output-path prompt. */
export const EXPORT_PATH_TITLE = "Export to";

/** Footer hints while the output-path prompt is open. */
export const EXPORT_PATH_HINTS: KeyHint[] = [
	["Enter", "export"],
	["Esc", "back"],
	["folder", "default name inside"],
];
