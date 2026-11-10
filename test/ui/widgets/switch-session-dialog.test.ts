import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { initI18n, t } from "../../../src/i18n/index.ts";
import { CONFIRM_NO_INDEX, CONFIRM_YES_INDEX } from "../../../src/ui/widgets/confirm-dialog.ts";
import { SwitchSessionDialog, type SwitchSessionDialogSpec } from "../../../src/ui/widgets/switch-session-dialog.ts";

const WARNING = "\x1b[33m";
const BORDER = "\x1b[96m";
const SELECTED = "\x1b[44m";
const colors: Record<string, string> = { warning: WARNING, borderAccent: BORDER, accent: "\x1b[36m", text: "\x1b[97m", muted: "\x1b[37m", dim: "\x1b[90m" };
const theme = {
	fg: (color: string, text: string) => `${colors[color]}${text}\x1b[39m`,
	bg: (_color: string, text: string) => `${SELECTED}${text}\x1b[49m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as unknown as Theme;

function switchSpec(target: string, onConfirm: () => void, onCancel: () => void): SwitchSessionDialogSpec {
	return { target, onConfirm, onCancel };
}

/** Coordinates of a visible label in terminal columns, including wide characters. */
function position(lines: string[], label: string): { x: number; y: number } {
	const y = lines.findIndex((line) => line.includes(label));
	assert.ok(y >= 0, `visible label: ${label}`);
	const line = lines[y]!;
	return { x: visibleWidth(line.slice(0, line.indexOf(label))), y };
}

for (const locale of ["en", "zh"] as const) {
	test(`SwitchSessionDialog keeps Yes on the left and No on the right at every dialog width (${locale})`, () => {
		initI18n(locale);
		try {
			let confirmed = 0;
			let cancelled = 0;
			const dialog = new SwitchSessionDialog({ theme, onChange: () => {} });
			const spec = switchSpec("PiLazyPanel · 11/07", () => confirmed++, () => cancelled++);
			for (const width of [24, 32, 60, 100]) {
				dialog.open(spec);
				const raw = dialog.render(width);
				const lines = raw.map(stripTerminalSequences);
				const yes = position(lines, `[ ${t("confirm.yes")} ]`);
				const no = position(lines, `[ ${t("confirm.no")} ]`);
				assert.ok(raw.every((line) => visibleWidth(line) === width));
				assert.equal(yes.y, no.y, "buttons always share one row, including narrow windows");
				assert.ok(yes.x < no.x);
				assert.ok(lines[no.y]!.includes(`› [ ${t("confirm.no")} ]`));
				assert.equal(dialog.selectedIndex, CONFIRM_NO_INDEX);
				assert.equal(raw[no.y]!.split(SELECTED).length - 1, 1, "only No has the selected background");
			}
			dialog.open(spec);
			const raw = dialog.render(60);
			const lines = raw.map(stripTerminalSequences);
			assert.ok(raw.every((line) => visibleWidth(line) === 60));
			assert.ok(lines[0]!.includes(t("confirm.switchRunning")));
			assert.ok(!lines[0]!.includes("PiLazyPanel"), "the target has a full body row instead of a clipped header");
			assert.ok(lines.some((line) => line.includes(t("confirm.switchRunningTarget")) && line.includes("PiLazyPanel · 11/07")));
			const warning = position(lines, t("confirm.switchRunningWarning"));
			assert.ok(raw[warning.y]!.includes(WARNING));
			assert.ok(raw[0]!.includes(BORDER) && !raw[0]!.includes(WARNING), "only the warning is yellow");

			for (const cancel of ["\r", "n", "\x1b"]) {
				dialog.open(spec);
				dialog.handleInput(cancel);
			}
			assert.equal(confirmed, 0, "Enter, n and Esc never interrupt the current conversation by default");
			assert.equal(cancelled, 3);
			dialog.open(spec);
			dialog.handleInput("\x1b[C");
			assert.equal(dialog.selectedIndex, CONFIRM_NO_INDEX);
			assert.equal(confirmed, 0, "moving the cursor does not execute an action");
			dialog.handleInput("\x1b[D");
			assert.equal(dialog.selectedIndex, CONFIRM_YES_INDEX);
			dialog.handleInput("j");
			assert.equal(dialog.selectedIndex, CONFIRM_NO_INDEX);
			dialog.handleInput("k");
			dialog.handleInput("\r");
			assert.equal(confirmed, 1, "j and Enter remain supported");
			dialog.open(spec);
			dialog.handleInput("y");
			assert.equal(confirmed, 2, "y confirms directly");
		} finally {
			initI18n("en");
		}
	});
}

test("confirmation mouse hits follow both horizontal buttons without selecting warnings, targets or gaps", () => {
	for (const locale of ["en", "zh"] as const) {
		initI18n(locale);
		try {
			const dialog = new SwitchSessionDialog({ theme, onChange: () => {} });
			const target = "很长的会话名称".repeat(4) + " · 11/07";
			dialog.open(switchSpec(target, () => {}, () => {}));
			for (const width of [24, 32, 60, 100]) {
				const raw = dialog.overlay(Array.from({ length: 64 }, () => " ".repeat(width)), width);
				const lines = raw.map(stripTerminalSequences);
				assert.ok(raw.every((line) => visibleWidth(line) === width));
				const yes = position(lines, `[ ${t("confirm.yes")} ]`);
				const no = position(lines, `[ ${t("confirm.no")} ]`);
				assert.equal(dialog.indexAt(yes.x, yes.y), CONFIRM_YES_INDEX);
				assert.equal(dialog.indexAt(no.x, no.y), CONFIRM_NO_INDEX);
				assert.equal(yes.y, no.y);
				const warning = position(lines, "! ");
				const detail = position(lines, t("confirm.switchRunningTarget"));
				assert.equal(dialog.indexAt(warning.x, warning.y), undefined);
				assert.equal(dialog.indexAt(detail.x, detail.y), undefined);
				const value = lines.slice(detail.y, yes.y)
					.map((line) => line.slice(line.indexOf("│") + 1, line.lastIndexOf("│")).trim())
					.join("").replace(/\s/g, "");
				assert.equal(value, (t("confirm.switchRunningTarget") + target).replace(/\s/g, ""), "a long wide-character target wraps in full");
				assert.equal(dialog.indexAt(no.x - 3, no.y), undefined, "the space between buttons is not an action");
				const endX = visibleWidth(lines[no.y]!.slice(0, lines[no.y]!.lastIndexOf("]")));
				assert.equal(dialog.indexAt(endX, no.y), CONFIRM_NO_INDEX);
			}
		} finally {
			initI18n("en");
		}
	}
});

test("long targets and short viewports keep both actions visible and clickable", () => {
	for (const locale of ["en", "zh"] as const) {
		initI18n(locale);
		try {
			const dialog = new SwitchSessionDialog({ theme, onChange: () => {} });
			dialog.open(switchSpec("很长的会话名称".repeat(100), () => {}, () => {}));
			for (const width of [24, 60]) {
				for (const height of [6, 8, 23]) {
					const lines = dialog.overlay(Array.from({ length: height }, () => " ".repeat(width)), width).map(stripTerminalSequences);
					assert.ok(lines.every((line) => visibleWidth(line) === width));
					const yes = position(lines, `[ ${t("confirm.yes")} ]`);
					const no = position(lines, `[ ${t("confirm.no")} ]`);
					assert.equal(yes.y, no.y);
					assert.equal(dialog.indexAt(yes.x, yes.y), CONFIRM_YES_INDEX);
					assert.equal(dialog.indexAt(no.x, no.y), CONFIRM_NO_INDEX);
					assert.ok(lines.some((line) => line.includes(t("confirm.switchRunningTarget"))));
					assert.ok(lines.some((line) => line.includes("…")), "oversized text is compacted");
					assert.ok(lines.some((line) => line.includes("└")), "the complete dialog fits inside the viewport");
				}
			}
		} finally {
			initI18n("en");
		}
	}
});

test("closing and reopening the dialog clears its mouse regions and restores the safe default", () => {
	initI18n("en");
	let confirmed = 0;
	const dialog = new SwitchSessionDialog({ theme, onChange: () => {} });
	const spec = switchSpec("PiLazyPanel", () => confirmed++, () => {});
	dialog.open(spec);
	const lines = dialog.overlay(Array.from({ length: 30 }, () => " ".repeat(60)), 60).map(stripTerminalSequences);
	const yes = position(lines, "[ Yes ]");
	dialog.moveTo(CONFIRM_YES_INDEX);
	dialog.close();
	assert.equal(dialog.isOpen, false);
	assert.deepEqual(dialog.hints, []);
	assert.equal(dialog.indexAt(yes.x, yes.y), undefined);
	dialog.handleInput("y");
	assert.equal(confirmed, 0);
	dialog.open(spec);
	assert.equal(dialog.selectedIndex, CONFIRM_NO_INDEX);
	assert.equal(dialog.indexAt(yes.x, yes.y), undefined, "regions only become active after drawing");
});
