import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_KEYMAP } from "../src/config/keymap.ts";
import { initI18n } from "../src/i18n/index.ts";
import { frame, overlayCentered } from "../src/ui/frame.ts";
import { ChangelogDialog } from "../src/ui/widgets/changelog-dialog.ts";
import { ContextUsageDialog } from "../src/ui/widgets/context-usage-dialog.ts";
import { renderFooter, type FooterProps } from "../src/ui/widgets/footer.ts";
import { overlayHelp } from "../src/ui/widgets/help-overlay.ts";
import { InputDialog } from "../src/ui/widgets/input-dialog.ts";
import { PromptDetailDialog } from "../src/ui/widgets/prompt-detail-dialog.ts";
import { SelectDialog } from "../src/ui/widgets/select-dialog.ts";
import { SessionInfoDialog } from "../src/ui/widgets/session-info-dialog.ts";
import { TreeDialog } from "../src/ui/widgets/tree-dialog.ts";

initI18n("en");
initTheme("dark", false);

const DIM = "\x1b[90m";
const ACCENT = "\x1b[36m";
const BORDER = "\x1b[96m";
const SELECTED = "\x1b[44m";
const WARNING = "\x1b[33m";
const colors: Record<string, string> = { dim: DIM, accent: ACCENT, borderAccent: BORDER, warning: WARNING, muted: "\x1b[37m", text: "\x1b[97m" };
const theme = {
	fg: (color: string, text: string) => `${colors[color] ?? "\x1b[37m"}${text}\x1b[39m`,
	bg: (_color: string, text: string) => `${SELECTED}${text}\x1b[49m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as unknown as Theme;

function backdrop(text: string): string {
	return theme.fg("dim", text);
}

function box(width: number, height: number, body: string[] = []): string[] {
	return frame(body, { width, height, title: "", border: (text) => theme.fg("borderAccent", text), titleStyle: (text) => text });
}

test("modal backdrop clears background emphasis and cursor, leaving the active box and input marker intact", () => {
	const base = Array.from({ length: 10 }, () => `\x1b[31m${SELECTED}\x1b[1;7mx${CURSOR_MARKER}${"x".repeat(19)}\x1b[0m`);
	const original = [...base];
	const modal = box(4, 3, [`a${CURSOR_MARKER}b`]);
	const out = overlayCentered(base, modal, 4, 20, backdrop);
	const all = out.join("\n");
	assert.deepEqual(base, original, "rendering must not mutate the background");
	assert.equal(out.length, base.length);
	assert.ok(out.every((line) => visibleWidth(line) === 20));
	assert.ok(out[0]!.includes(DIM));
	assert.ok(!all.includes("\x1b[31m"));
	assert.ok(!all.includes(SELECTED));
	assert.ok(!all.includes("\x1b[1;7m"));
	assert.equal(all.split(CURSOR_MARKER).length - 1, 1, "only the active input keeps its IME marker");
	assert.ok(out[3]!.includes(BORDER), "the active border keeps its original colour");

	const plain = out.map(stripTerminalSequences);
	assert.equal(plain[2], "xxxxxxx      xxxxxxx", "one blank row above the original box position");
	assert.equal(plain[3], "xxxxxxx ┌──┐ xxxxxxx");
	assert.equal(plain[4], "xxxxxxx │ab│ xxxxxxx");
	assert.equal(plain[5], "xxxxxxx └──┘ xxxxxxx");
	assert.equal(plain[6], "xxxxxxx      xxxxxxx", "one blank row below");
	assert.equal(plain[1], "x".repeat(20));
	assert.equal(plain[7], "x".repeat(20));
});

test("nested overlays demote the parent without accumulating styles or changing its original render", () => {
	const base = Array.from({ length: 13 }, () => "x".repeat(30));
	const parent = overlayCentered(base, box(24, 9, [theme.bg("selectedBg", "parent")]), 24, 30, backdrop);
	const original = [...parent];
	const child = box(8, 3, [theme.fg("accent", "child")]);
	const nested = overlayCentered(parent, child, 8, 30, backdrop);
	assert.deepEqual(parent, original);
	assert.ok(!nested.join("\n").includes(SELECTED), "parent selection no longer competes with the child");
	assert.ok(nested[2]!.includes(DIM));
	assert.ok(!nested[2]!.includes(BORDER), "parent's top border is now background");
	assert.ok(nested[5]!.includes(BORDER), "child border is still accented");
	assert.ok(nested[6]!.includes(ACCENT));
	assert.equal(backdrop(stripTerminalSequences(backdrop("x"))), backdrop("x"), "background styling is idempotent");
});

test("modal gutter clips at small terminal edges without resizing the box or breaking wide columns", () => {
	const modal = box(6, 3, ["中文"]);
	for (const width of [1, 2, 3, 4, 6, 7, 10, 11, 20]) {
		for (const height of [0, 1, 2, 3, 4, 5, 9]) {
			const base = Array.from({ length: height }, () => "中文".repeat(Math.ceil(width / 4)).slice(0, Math.floor(width / 2)) + (width % 2 ? "x" : ""));
			const out = overlayCentered(base, modal, 6, width, backdrop);
			assert.equal(out.length, height);
			assert.ok(out.every((line) => visibleWidth(line) === width), `${width}x${height}: ${JSON.stringify(out)}`);
			if (width >= 6 && height >= 3) {
				const top = Math.floor((height - 3) / 2);
				const line = stripTerminalSequences(out[top]!);
				assert.equal(visibleWidth(line.slice(0, line.indexOf("┌"))), Math.floor((width - 6) / 2));
			}
		}
	}
});

test("every dialog uses the same subdued backdrop and keeps single-line accent borders", () => {
	const input = new InputDialog({ theme, onChange: () => {} });
	input.open({ title: "Input", hints: [], value: "value", onSubmit: () => {}, onCancel: () => {} });
	const select = new SelectDialog({ theme, onChange: () => {} });
	select.open({ title: "Menu", items: ["Yes", "No"], hints: [], onSelect: () => {}, onCancel: () => {} });
	const tree = new TreeDialog({ theme, onChange: () => {} });
	tree.open({ rows: [], filter: "default" });
	const info = new SessionInfoDialog({ theme });
	info.open({ info: { id: "id", path: "session.jsonl", messages: 1, tokens: 100, cost: 0, createdAt: 0, updatedAt: 0 }, onCopy: () => {}, onClose: () => {} });
	const usage = new ContextUsageDialog({ theme });
	usage.open({ info: { used: 100, messages: 1, categories: [{ key: "systemPrompt", color: "accent", tokens: 100, prompt: "Source" }] }, onCopy: () => {}, onClose: () => {} });
	const detail = new PromptDetailDialog(theme);
	detail.open({ category: "Context", prompt: "Source", onCopy: () => {} });
	const changelog = new ChangelogDialog({ theme, onClose: () => {} });
	changelog.setContent("# Changelog\n\nA change");
	const widgets = [input, select, tree, info, usage, detail, changelog];
	const base = Array.from({ length: 26 }, () => `\x1b[31m${"x".repeat(100)}\x1b[39m`);
	const renders = widgets.map((widget) => widget.overlay(base, 100));
	renders.push(overlayHelp(base, { keymap: DEFAULT_KEYMAP, focus: "sessions", scroll: 0, theme }, 100));
	usage.handleInput("\r");
	renders.push(usage.overlay(base, 100));
	changelog.openLoading();
	renders.push(changelog.overlay(base, 100));
	for (const out of renders) {
		const all = out.join("\n");
		assert.equal(out.length, 26);
		assert.ok(out.every((line) => visibleWidth(line) === 100));
		assert.ok(all.includes(DIM));
		assert.ok(all.includes(`${BORDER}┌`));
		assert.ok(!all.includes("\x1b[31m"), "no original background colour survives");
		assert.ok(!all.includes("╔"), "single-line border shape is unchanged");
	}
});

function footerProps(): FooterProps {
	return { mode: "rename", focus: "sessions", keymap: DEFAULT_KEYMAP, theme, hints: [["Enter", "save"], ["Esc", "cancel"]], version: "0.1.4" };
}

test("modal footer gives complete hints priority over the version in a narrow terminal", () => {
	const props = { ...footerProps(), modal: true };
	const expected = stripTerminalSequences(renderFooter({ ...props, version: "" }, 100)[0]!).trimEnd();
	const width = visibleWidth(expected) + 1;
	const narrow = renderFooter(props, width)[0]!;
	assert.equal(stripTerminalSequences(narrow).trimEnd(), expected);
	assert.ok(!narrow.includes("v0.1.4"));
	assert.equal(visibleWidth(narrow), width);
	const wide = renderFooter(props, 100)[0]!;
	assert.ok(wide.includes(`${DIM}v0.1.4`));
	assert.ok(wide.includes(theme.fg("text", "save")), "modal descriptions are more readable");
});

test("modal footer preserves warning emphasis and supports a display-only mode label", () => {
	const out = renderFooter({ ...footerProps(), modal: true, modeLabel: "HELP", status: "Failed to load" }, 100)[0]!;
	assert.ok(out.includes(`${WARNING}Failed to load`));
	assert.ok(stripTerminalSequences(out).startsWith(" HELP "));
	assert.ok(stripTerminalSequences(out).includes("Enter save   Esc cancel"));
	assert.equal(visibleWidth(out), 100);
	const narrow = renderFooter({ ...footerProps(), modal: true, status: "Failed to load" }, 25)[0]!;
	assert.ok(narrow.includes(`${WARNING}Failed to load`));
	assert.ok(!narrow.includes("v0.1.4"));
});

test("ordinary footer retains its muted descriptions and reserved version space", () => {
	const props = footerProps();
	const out = renderFooter(props, 100)[0]!;
	assert.ok(out.includes(theme.fg("muted", "save")));
	assert.ok(out.includes(theme.fg("muted", "v0.1.4")));
	const narrow = stripTerminalSequences(renderFooter(props, 34)[0]!);
	assert.ok(narrow.includes("v0.1.4"));
	assert.ok(!narrow.includes("Esc cancel"), "normal footer still reserves room for its version");
});
