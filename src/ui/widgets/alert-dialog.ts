/**
 * Alert dialog: a one-button acknowledgement box for "you can't do that"
 * warnings, e.g. trying to delete the session pi currently has open.
 *
 *   ┌─ Can't delete the active session ──── FilmRecall ─┐
 *   │ › OK                                               │
 *   └────────────────────────────────────────────────────┘
 *    CONFIRM │ Enter/Esc close                            <- footer while open
 *
 * A preset of ./select-dialog.ts like ./confirm-dialog.ts, but with a single
 * item that just closes: Enter, Esc or picking OK all dismiss it. The message
 * lives in the title (self-explanatory), the subject names what it is about.
 * Only holds text and callbacks — no I/O.
 *
 * 警告框：只有一个"知道了"按钮的居中弹窗，用来提示无法执行的操作（比如删除
 * pi 当前打开的会话）。Enter / Esc / 选 OK 都只是关闭。
 */

import { t } from "../../i18n/index.ts";
import type { KeyHint } from "../../types.ts";
import type { SelectDialogSpec } from "./select-dialog.ts";

/** Footer hints while an alert is open. */
export function alertHints(): KeyHint[] {
	return [["Enter/Esc", t("hint.close")]];
}

/** Title of the warning shown when the user tries to delete pi's active session. */
export function cannotDeleteActiveTitle(): string {
	return t("alert.cannotDeleteActive");
}

export interface AlertSpecOptions {
	/** Title on the top border, i.e. the warning message itself. */
	title: string;
	/** What the warning is about, shown at the right end of the title bar. */
	subject?: string;
	onClose: () => void;
}

/**
 * The `SelectDialog.open` spec of an alert: one OK entry; selecting it or
 * cancelling both call `onClose`.
 */
export function alertDialogSpec(o: AlertSpecOptions): SelectDialogSpec {
	return {
		title: o.title,
		items: [t("alert.ok")],
		...(o.subject ? { subject: o.subject } : {}),
		hints: alertHints(),
		// 警告框用红色（error）边框 / 标题，和确认框区分开。
		tone: "error",
		onSelect: () => o.onClose(),
		onCancel: () => o.onClose(),
	};
}
