/**
 * Confirm presets drawn through the real SelectDialog: Yes / No by default,
 * and the same box with its entries spelled out before leaving a conversation
 * that is still running.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { initI18n, t } from "../../../src/i18n/index.ts";
import {
	CONFIRM_NO_INDEX,
	confirmDialogSpec,
	deleteSessionTitle,
	switchSessionLabels,
	switchSessionTitle,
} from "../../../src/ui/widgets/confirm-dialog.ts";
import { SelectDialog } from "../../../src/ui/widgets/select-dialog.ts";

const SELECTED = "\x1b[44m";
const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => `${SELECTED}${text}\x1b[49m`,
	bold: (text: string) => text,
} as unknown as Theme;

const SUBJECT = "beta · 11/07";

for (const locale of ["en", "zh"] as const) {
	test(`the switch confirmation is the usual confirmation with its two entries spelled out (${locale})`, () => {
		initI18n(locale);
		try {
			const noop = (): void => {};
			const usual = confirmDialogSpec({ title: deleteSessionTitle(), subject: SUBJECT, onConfirm: noop, onCancel: noop });
			const spec = confirmDialogSpec({ title: switchSessionTitle(), labels: switchSessionLabels(), subject: SUBJECT, onConfirm: noop, onCancel: noop });
			const labels = switchSessionLabels();

			// 只有两项的文案不同：默认光标、y / n、footer 提示都沿用通用确认框。
			assert.deepEqual(usual.items, [t("confirm.yes"), t("confirm.no")]);
			assert.deepEqual(spec.items, [labels.confirm, labels.cancel]);
			assert.equal(spec.initialIndex, CONFIRM_NO_INDEX);
			assert.deepEqual(spec.shortcuts, usual.shortcuts);
			assert.deepEqual(spec.hints, usual.hints);

			const dialog = new SelectDialog({ theme, onChange: noop });
			dialog.open(usual);
			const usualHeight = dialog.render(60).length;
			dialog.open(spec);
			const raw = dialog.render(60);
			const lines = raw.map(stripTerminalSequences);
			assert.equal(lines.length, usualHeight, "no explanation rows: as tall as Delete session?");
			assert.ok(lines[0]!.includes(`┌─ ${switchSessionTitle()} `) && lines[0]!.includes(`${SUBJECT} ─┐`), lines[0]);
			assert.ok(lines[1]!.includes(`  ${labels.confirm}`) && !lines[1]!.includes("›"), lines[1]);
			assert.ok(lines[2]!.includes(`› ${labels.cancel}`), lines[2]);
			assert.ok(!raw[1]!.includes(SELECTED) && raw[2]!.includes(SELECTED), "the cursor starts on staying");

			// 窄终端只截断文案：两项仍各占一行，每行恰好是弹窗宽度（中文是宽字符）。
			for (const width of [24, 32, 60, 100]) {
				const narrow = dialog.render(width);
				assert.equal(narrow.length, usualHeight);
				assert.ok(narrow.every((line) => visibleWidth(line) === width), `every line is ${width} columns`);
				const plain = narrow.map(stripTerminalSequences);
				assert.ok(plain[1]!.includes(labels.confirm.slice(0, 4)), plain[1]);
				assert.ok(plain[2]!.includes(`› ${labels.cancel.slice(0, 4)}`), plain[2]);
			}
		} finally {
			initI18n("en");
		}
	});
}

test("the switch confirmation answers like every confirmation: only y or Enter on the first entry go ahead", () => {
	initI18n("en");
	let confirmed = 0;
	let cancelled = 0;
	const dialog = new SelectDialog({ theme, onChange: () => {} });
	const open = (): void => dialog.open(confirmDialogSpec({
		title: switchSessionTitle(),
		labels: switchSessionLabels(),
		subject: SUBJECT,
		onConfirm: () => confirmed++,
		onCancel: () => cancelled++,
	}));

	// Enter 停在默认项、n、Esc：都留在当前对话。
	for (const key of ["\r", "n", "\x1b"]) {
		open();
		dialog.handleInput(key);
	}
	assert.deepEqual([confirmed, cancelled], [0, 3]);

	// 其他键被吞掉，光标不动。
	open();
	for (const key of ["\x1b[D", "\x1b[C", "h", "l", "q", " "]) dialog.handleInput(key);
	assert.equal(dialog.selectedIndex, CONFIRM_NO_INDEX);
	assert.deepEqual([confirmed, cancelled], [0, 3]);

	// k + Enter、y：切换。
	dialog.handleInput("k");
	dialog.handleInput("\r");
	assert.deepEqual([confirmed, cancelled], [1, 3]);
	open();
	dialog.handleInput("y");
	assert.deepEqual([confirmed, cancelled], [2, 3]);
});
