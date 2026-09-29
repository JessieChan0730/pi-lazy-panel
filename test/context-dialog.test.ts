import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { initI18n, t } from "../src/i18n/index.ts";
import type { ContextUsageInfo } from "../src/types.ts";
import { ContextUsageDialog } from "../src/ui/widgets/context-usage-dialog.ts";
import { PromptDetailDialog } from "../src/ui/widgets/prompt-detail-dialog.ts";

initI18n("en");
initTheme("dark", false);
const theme = {
	fg: (_c: string, s: string) => s,
	bg: (_c: string, s: string) => s,
	bold: (s: string) => s,
} as unknown as Theme;

function info(): ContextUsageInfo {
	return {
		used: 100, messages: 2, contextWindow: 1000, percent: 0.1,
		categories: [
			{ key: "systemPrompt", color: "accent", tokens: 30, prompt: "System source" },
			{ key: "memory", color: "error", tokens: 0, prompt: "" },
			{ key: "context", color: "warning", tokens: 70, prompt: "Context source" },
			{ key: "other", color: "dim", tokens: 0 },
			{ key: "freeSpace", color: "dim", tokens: 900 },
		],
	};
}

function selected(dialog: ContextUsageDialog, height?: number): string {
	return dialog.render(60, height).map(stripTerminalSequences).find((line) => line.includes("›")) ?? "";
}

test("context list navigation clamps, skips statistics, and keeps its cursor visible in a short terminal", () => {
	const dialog = new ContextUsageDialog({ theme });
	dialog.open({ info: info(), onCopy: () => {}, onClose: () => dialog.close() });
	assert.match(selected(dialog), /System prompt/);
	dialog.handleInput("k");
	assert.match(selected(dialog), /System prompt/);
	dialog.handleInput("\x1b[B");
	assert.match(selected(dialog), /Memory/);
	dialog.handleInput("j");
	for (let i = 0; i < 10; i++) dialog.handleInput("j");
	assert.match(selected(dialog, 5), /Context/);
	const rows = dialog.render(60, 5);
	assert.equal(rows.length, 5);
	assert.ok(rows.every((line) => visibleWidth(line) === 60));
	dialog.handleInput("\x1b[A");
	assert.match(selected(dialog, 5), /Memory/);
	dialog.handleInput("k");
	assert.match(selected(dialog, 5), /System prompt/);
});

test("empty prompts open a preview; nested Esc/q returns without closing the parent or losing selection", () => {
	const dialog = new ContextUsageDialog({ theme });
	let closed = 0;
	dialog.open({ info: info(), onCopy: () => {}, onClose: () => {
		closed++;
		dialog.close();
	} });
	dialog.handleInput("j");
	dialog.handleInput("\r");
	const base = Array.from({ length: 16 }, () => " ".repeat(80));
	const preview = dialog.overlay(base, 80).map(stripTerminalSequences).join("\n");
	assert.match(preview, /Prompt · Memory/);
	assert.match(preview, /No prompt content in this category/);
	assert.ok(dialog.hints.some(([key, label]) => key === "Esc" && label === "back"));
	dialog.handleInput("\x1b");
	assert.equal(closed, 0);
	assert.match(selected(dialog), /Memory/);
	dialog.handleInput("\r");
	dialog.handleInput("q");
	assert.equal(closed, 0);
	dialog.handleInput("q");
	assert.equal(closed, 1);
	assert.equal(dialog.isOpen, false);
	assert.deepEqual(dialog.hints, []);
	// Closing/reopening while the child is visible must clear all child state.
	dialog.open({ info: info(), onCopy: () => {}, onClose: () => {} });
	dialog.handleInput("\r");
	dialog.close();
	dialog.open({ info: info(), onCopy: () => {}, onClose: () => {} });
	assert.match(dialog.overlay(base, 80).join("\n"), /Context Usage/);
});

test("statistics-only and empty context lists swallow Enter and navigation safely", () => {
	const dialog = new ContextUsageDialog({ theme });
	for (const categories of [[], [{ key: "other", color: "dim" as const, tokens: 100 }]]) {
		dialog.open({ info: { used: 100, messages: 0, categories }, onCopy: () => {}, onClose: () => {} });
		for (const key of ["j", "k", "\x1b[A", "\x1b[B", "\r"]) dialog.handleInput(key);
		assert.equal(selected(dialog), "");
		assert.ok(dialog.hints.some(([key, label]) => key === "Esc" && label === "close"));
	}
});

test("prompt detail scrolls, pages, clamps, copies the original text and resets on another prompt", () => {
	const dialog = new PromptDetailDialog(theme);
	const prompt = Array.from({ length: 80 }, (_, i) => `Line ${String(i).padStart(3, "0")} 中文 **source**`).join("\n\n");
	const copies: string[] = [];
	dialog.open({ category: "Context", prompt, onCopy: (text) => copies.push(text) });
	const top = dialog.render(72, 10);
	dialog.handleInput("k");
	assert.deepEqual(dialog.render(72, 10), top);
	dialog.handleInput("j");
	assert.notDeepEqual(dialog.render(72, 10), top);
	dialog.handleInput("\x1b[A");
	assert.deepEqual(dialog.render(72, 10), top);
	dialog.handleInput("\x1b[B");
	dialog.handleInput("k");
	assert.deepEqual(dialog.render(72, 10), top);
	for (const [down, up] of [["\x04", "\x15"], ["\x1b[6~", "\x1b[5~"]]) {
		dialog.handleInput(down!);
		assert.notDeepEqual(dialog.render(72, 10), top);
		dialog.handleInput(up!);
		assert.deepEqual(dialog.render(72, 10), top);
	}
	dialog.handleInput("G");
	const bottom = dialog.render(72, 10);
	assert.match(bottom.map(stripTerminalSequences).join("\n"), /Line 079/);
	dialog.handleInput("j");
	assert.deepEqual(dialog.render(72, 10), bottom);
	dialog.handleInput("y");
	assert.deepEqual(copies, [prompt]);
	dialog.handleInput("g");
	assert.deepEqual(dialog.render(72, 10), top);
	for (const width of [24, 40, 100]) {
		const rows = dialog.render(width, 8);
		assert.equal(rows.length, 8);
		assert.ok(rows.every((line) => visibleWidth(line) === width));
	}
	dialog.open({ category: "Memory", prompt: "Replacement source", onCopy: () => {} });
	const replacement = dialog.render(72, 10).map(stripTerminalSequences).join("\n");
	assert.match(replacement, /Replacement source/);
	assert.ok(!replacement.includes("Line 000"));
	dialog.handleInput("\x1b");
	assert.equal(dialog.isOpen, false);
});

/** Only the help inside the box, never the main panel's footer. */
function localHints(rows: string[]): string[] {
	const plain = rows.map(stripTerminalSequences);
	const divider = plain.map((line) => line.startsWith("├")).lastIndexOf(true);
	assert.ok(divider >= 0, "a divider separates content from the local help");
	return plain.slice(divider + 1, -1);
}

test("context and prompt dialogs show local shortcuts in both languages and wrap them in narrow boxes", () => {
	try {
		for (const locale of ["en", "zh"] as const) {
			initI18n(locale);
			const usage = new ContextUsageDialog({ theme });
			usage.open({ info: info(), onCopy: () => {}, onClose: () => {} });
			const prompt = new PromptDetailDialog(theme);
			prompt.open({ category: "Context", prompt: "Source\n\n".repeat(60), onCopy: () => {} });
			for (const width of [24, 40, 60, 100]) {
				const usageRows = usage.render(width, 18);
				const usageHelp = localHints(usageRows).join("\n");
				for (const hint of [`j/k/↑↓ ${t("hint.select")}`, `Enter ${t("hint.preview")}`, `y ${t("hint.copy")}`, `Esc ${t("hint.close")}`]) assert.ok(usageHelp.includes(hint), usageHelp);
				assert.ok(usageRows.every((line) => visibleWidth(line) === width));
				const top = prompt.render(width, 18);
				const promptHelp = localHints(top);
				for (const hint of [`j/k/↑↓ ${t("hint.scroll")}`, `ctrl+d/u ${t("hint.page")}`, `g/G ${t("hint.topBottom")}`, `y ${t("hint.copy")}`, `Esc ${t("hint.back")}`]) assert.ok(promptHelp.join("\n").includes(hint), promptHelp.join("\n"));
				prompt.handleInput("G");
				const bottom = prompt.render(width, 18);
				assert.deepEqual(localHints(bottom), promptHelp, "scrolling does not move the local help");
				assert.equal(bottom.length, 18);
				assert.ok(bottom.every((line) => visibleWidth(line) === width));
			}
		}
	} finally {
		initI18n("en");
	}
});
