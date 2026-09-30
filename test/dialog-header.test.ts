import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { initI18n, t } from "../src/i18n/index.ts";
import type { SessionInfo } from "../src/types.ts";
import { frame } from "../src/ui/frame.ts";
import { alertDialogSpec } from "../src/ui/widgets/alert-dialog.ts";
import { ChangelogDialog } from "../src/ui/widgets/changelog-dialog.ts";
import { dialogHeader } from "../src/ui/widgets/dialog-header.ts";
import { InputDialog } from "../src/ui/widgets/input-dialog.ts";
import { SelectDialog } from "../src/ui/widgets/select-dialog.ts";
import { SessionInfoDialog } from "../src/ui/widgets/session-info-dialog.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

const info: SessionInfo = {
	messages: 12, tokens: 100, cost: 0, createdAt: 0, updatedAt: 0,
	path: "/sessions/example.jsonl", id: "session-id",
};

function assertHeader(lines: string[], width: number, hint: string): void {
	const header = stripTerminalSequences(lines[0]!);
	assert.ok(header.endsWith(` ${hint} ─┐`), header);
	for (const line of lines) assert.equal(visibleWidth(line), width);
}

function assertCompactHeader(lines: string[], width: number): void {
	const header = stripTerminalSequences(lines[0]!);
	assert.equal(header.includes("Esc"), false, header);
	for (const line of lines) assert.equal(visibleWidth(line), width);
	if (width >= 40) assert.ok(header.includes("session A"), header);
}

for (const locale of ["en", "zh"] as const) {
	test(`dialog headers keep Escape visible with long titles and subjects (${locale})`, () => {
		initI18n(locale);
		try {
			const close = locale === "en" ? "Esc close" : "Esc 关闭";
			for (const width of [24, 40, 60, 100]) {
				for (const title of ["Info", "很长的标题 with wide characters ".repeat(5)]) {
					const lines = frame([], {
						width, height: 2,
						...dialogHeader(width, title, "很长的会话名 ".repeat(20)),
						border: (text) => text, titleStyle: (text) => text,
					});
					assertHeader(lines, width, close);
				}
			}
			assert.equal(dialogHeader(60, "Info").meta, close, "unnamed subjects still show Escape");
			assert.equal(dialogHeader(60, "Info", "session A").meta, `session A · ${close}`);
		} finally {
			initI18n("en");
		}
	});

	test(`session info shows Escape while compact inputs and menus keep their original headers (${locale})`, () => {
		initI18n(locale);
		try {
			const session = new SessionInfoDialog({ theme });
			const input = new InputDialog({ theme, onChange: () => {} });
			const menu = new SelectDialog({ theme, onChange: () => {} });
			let cancelled = 0;
			for (const width of [24, 40, 60, 100]) {
				for (const name of ["", "session A", "很长的会话名 ".repeat(20)]) {
					session.open({ info: { ...info, ...(name ? { name } : {}) }, onCopy: () => {}, onClose: () => cancelled++ });
					assertHeader(session.render(width), width, `Esc ${t("hint.close")}`);
				}
				for (const action of ["hint.cancel", "hint.back"] as const) {
					const spec = {
						title: "Dialog", subject: "session A", hints: [["Esc", t(action)]] as Array<[string, string]>,
						onCancel: () => cancelled++,
					};
					input.open({ ...spec, value: "keep this text", onSubmit: () => assert.fail("Escape must not submit") });
					assertCompactHeader(input.render(width), width);
					input.handleInput("\x1b");
					assert.equal(input.getValue(), "keep this text");
					menu.open({ ...spec, items: ["First", "Second"], onSelect: () => assert.fail("Escape must not select") });
					assertCompactHeader(menu.render(width), width);
					menu.handleInput("\x1b");
				}
				menu.open(alertDialogSpec({ title: "Warning", subject: "session A", onClose: () => cancelled++ }));
				assertCompactHeader(menu.render(width), width);
				menu.handleInput("\x1b");
			}
			assert.equal(cancelled, 20);
		} finally {
			initI18n("en");
		}
	});

	test(`changelog shows Escape while loading, with short content and while scrolling (${locale})`, () => {
		initI18n(locale);
		try {
			const dialog = new ChangelogDialog({ theme, onClose: () => dialog.close() });
			for (const width of [24, 40, 60, 100]) {
				dialog.openLoading();
				assertHeader(dialog.render(width, 10), width, `Esc ${t("hint.close")}`);
				dialog.handleInput("\x1b");
				assert.equal(dialog.isOpen, false);
				dialog.setContent("Short update");
				assertHeader(dialog.render(width, 10), width, `Esc ${t("hint.close")}`);
				dialog.setContent("Long update\n\n".repeat(50));
				assertHeader(dialog.render(width, 10), width, `Esc ${t("hint.close")}`);
				dialog.handleInput("j");
				const lines = dialog.render(width, 10);
				assertHeader(lines, width, `Esc ${t("hint.close")}`);
				if (width >= 60) assert.match(lines[0]!, /2-9\/\d+ · Esc/);
				dialog.handleInput("\x1b");
				assert.equal(dialog.isOpen, false);
			}
		} finally {
			initI18n("en");
		}
	});
}
