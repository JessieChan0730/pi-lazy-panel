/**
 * data/context-usage.ts on real session files in a temp dir: the conversation
 * breakdown read from the file, the model / window lookup, the live
 * (current-session) prompt-side itemization, and the pure capParts /
 * usageSegments helpers.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatSkillsForPrompt, SessionManager, type Skill } from "@earendil-works/pi-coding-agent";
import { capParts, loadContextUsage, usageSegments, type LiveContextInputs } from "../src/data/context-usage.ts";
import type { ContextUsageCategory } from "../src/types.ts";

import { initI18n } from "../src/i18n/index.ts";

initI18n("en");

type AnyMessage = Parameters<SessionManager["appendMessage"]>[0];

function userMessage(text: string, timestamp: number): AnyMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp } as unknown as AnyMessage;
}

function assistantMessage(text: string, timestamp: number, usage: object): AnyMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "x",
		provider: "x",
		model: "x",
		usage,
		stopReason: "stop",
		timestamp,
	} as unknown as AnyMessage;
}

const USAGE = { input: 1000, output: 500, cacheRead: 8000, cacheWrite: 200, totalTokens: 9700, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.12 } };

/** A session: user → assistant (with usage) → model_change. Returns its file path. */
function makeSession(dir: string, opts: { model?: string } = {}): string {
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage(userMessage("hello there", 1));
	manager.appendMessage(assistantMessage("hi", 2, USAGE));
	if (opts.model) manager.appendModelChange("anthropic", opts.model);
	const file = manager.getSessionFile();
	assert.ok(file);
	return file;
}

function tempDir(t: { after: (fn: () => void) => void }): string {
	const dir = mkdtempSync(join(tmpdir(), "lazy-panel-usage-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function key(info: { categories: ContextUsageCategory[] }, k: string): ContextUsageCategory | undefined {
	return info.categories.find((c) => c.key === k);
}
function sum(cats: ContextUsageCategory[]): number {
	return cats.reduce((s, c) => s + c.tokens, 0);
}

test("loadContextUsage (other session): conversation itemized, the rest folds into Other, categories fill the window", async (t) => {
	const file = makeSession(tempDir(t), { model: "claude-opus-4" });
	const info = await loadContextUsage(file, { findContextWindow: (id) => (id === "claude-opus-4" ? 200_000 : undefined) });
	assert.ok(info);
	assert.equal(info.used, 9700, "used = the provider total from the last assistant usage");
	assert.equal(info.contextWindow, 200_000);
	assert.ok(Math.abs(info.percent! - 9700 / 200_000) < 1e-9);
	assert.equal(info.model, "claude-opus-4");
	assert.equal(info.messages, 2);
	assert.ok(Math.abs((info.cost ?? 0) - 0.12) < 1e-9);
	// other sessions can only itemize the conversation side; no prompt-side rows.
	assert.equal(key(info, "systemPrompt"), undefined);
	assert.ok(key(info, "context"), "Context is itemized from the file");
	assert.ok(key(info, "toolResults"), "Tool results is itemized from the file");
	assert.equal(key(info, "toolResults")!.color, "mdLink");
	assert.equal(key(info, "context")!.color, "warning");
	// Other holds the unattributable prompt / tools that the real request included.
	assert.ok(key(info, "other")!.tokens > 0);
	assert.equal(key(info, "other")!.color, "customMessageLabel");
	assert.equal(key(info, "other")!.color === key(info, "freeSpace")!.color, false);
	// Free space + every part sum to the whole window.
	assert.equal(sum(info.categories), 200_000);
	assert.equal(key(info, "freeSpace")!.tokens, 200_000 - 9700);
	// auto-compact threshold + remaining.
	assert.ok(Math.abs(info.compactThreshold! - (200_000 - 16_384) / 200_000) < 1e-9);
	assert.equal(info.compactRemaining, 200_000 - 16_384 - 9700);
});

test("loadContextUsage (other session): no model on record → token counts but no window / percent / free space", async (t) => {
	const file = makeSession(tempDir(t)); // no model_change
	const info = await loadContextUsage(file, { findContextWindow: () => undefined });
	assert.ok(info);
	assert.equal(info.used, 9700, "the provider total is still known");
	assert.equal(info.contextWindow, undefined);
	assert.equal(info.percent, undefined);
	assert.equal(info.compactThreshold, undefined);
	assert.equal(key(info, "freeSpace"), undefined, "no free-space row without a window");
	assert.ok(key(info, "context"));
});

test("loadContextUsage (current session): live inputs itemize the prompt side (system prompt / memory / skills / tools)", async (t) => {
	const file = makeSession(tempDir(t), { model: "claude-opus-4" });
	const memory = "MEMORY_CONTENT_XYZ_0123456789";
	const systemPrompt = `You are a careful assistant. ${memory} End of prompt.`;
	const live: LiveContextInputs = {
		usage: { tokens: 5000, contextWindow: 100_000, percent: 5 },
		systemPrompt,
		systemPromptOptions: { cwd: "/x", selectedTools: ["read"], contextFiles: [{ path: "MEM.md", content: memory }], skills: [] },
		tools: [{ name: "read", description: "Read a file", parameters: { type: "object" } } as never],
	};
	const info = await loadContextUsage(file, { live, findContextWindow: () => 200_000 });
	assert.ok(info);
	// live wins: window / used come from pi's own figure, not the 200k model lookup.
	assert.equal(info.contextWindow, 100_000);
	assert.equal(info.used, 5000);
	assert.ok(Math.abs(info.percent! - 0.05) < 1e-9);
	// the four prompt-side rows are present and non-zero where expected.
	assert.ok(key(info, "systemPrompt")!.tokens > 0);
	assert.ok(key(info, "memory")!.tokens > 0, "the embedded memory file is counted");
	assert.ok(key(info, "tools")!.tokens > 0, "the selected tool definition is counted");
	assert.ok(key(info, "skills"), "skills row exists (0 with no skills)");
	assert.ok(key(info, "context"));
	assert.ok(key(info, "toolResults"));
	assert.equal(key(info, "skills")!.color, "thinkingMax");
	assert.equal(key(info, "tools")!.color, "success");
	assert.equal(key(info, "toolResults")!.color, "mdLink");
	assert.equal(key(info, "context")!.color, "warning");
	assert.notEqual(key(info, "skills")!.color, key(info, "tools")!.color);
	assert.notEqual(key(info, "toolResults")!.color, key(info, "context")!.color);
	// every part + Other + Free space still sum to the window.
	assert.equal(sum(info.categories), 100_000);
});

test("loadContextUsage: an unreadable file returns undefined", async () => {
	const info = await loadContextUsage(join(tmpdir(), "does-not-exist-lazy-panel.jsonl"), {});
	assert.equal(info, undefined);
});

test("capParts scales the variable tail to the target and leaves the fixed prefix untouched", () => {
	const parts: ContextUsageCategory[] = [
		{ key: "systemPrompt", tokens: 1000, color: "accent" },
		{ key: "tools", tokens: 500, color: "success" },
		{ key: "toolResults", tokens: 300, color: "mdLink" },
		{ key: "context", tokens: 100, color: "warning" },
	];
	// target 1700, fixed prefix 2 (system + tools = 1500) → variable tail (400) capped to 200.
	const capped = capParts(parts, 1700, 2);
	assert.equal(capped[0]!.tokens, 1000, "fixed prefix untouched");
	assert.equal(capped[1]!.tokens, 500, "fixed prefix untouched");
	assert.equal(capped[2]!.tokens + capped[3]!.tokens, 200, "variable tail scaled down to the remaining budget");
	// estimate already under target → unchanged.
	assert.deepEqual(capParts(parts, 100_000, 2), parts);
});

test("usageSegments splits a bar proportionally, the last cell takes the remainder", () => {
	assert.deepEqual(usageSegments([50, 50], 100, 10), [5, 5]);
	assert.deepEqual(usageSegments([25, 25, 50], 100, 8), [2, 2, 4]);
	// the last segment absorbs rounding so the cells always add up to the width.
	const seg = usageSegments([33, 33, 34], 100, 10);
	assert.equal(seg.reduce((s, n) => s + n, 0), 10);
	assert.deepEqual(usageSegments([1, 1], 2, 0), [0, 0]);
});

test("context prompts preserve live sources and include only embedded memory/skills and selected tools", async (t) => {
	const file = makeSession(tempDir(t));
	const skill: Skill = {
		name: "sample", description: "Sample skill", filePath: "/skills/sample/SKILL.md", baseDir: "/skills/sample",
		disableModelInvocation: false,
		sourceInfo: { path: "/skills/sample", source: "test", scope: "user", origin: "top-level" },
	};
	const skillsText = formatSkillsForPrompt([skill]).trim();
	const live: LiveContextInputs = {
		usage: { tokens: 20_000, contextWindow: 100_000, percent: 20 },
		systemPrompt: `System source\n\nEmbedded memory\n\n${skillsText}`,
		systemPromptOptions: {
			cwd: "/x", selectedTools: ["read"], skills: [skill],
			contextFiles: [{ path: "AGENTS.md", content: "Embedded memory" }, { path: "UNUSED.md", content: "Not embedded" }],
		},
		tools: [
			{ name: "read", description: "Read source", parameters: { type: "object" }, sourceInfo: skill.sourceInfo },
			{ name: "unused", description: "Inactive tool", parameters: { type: "object" }, sourceInfo: skill.sourceInfo },
		],
	};
	const info = (await loadContextUsage(file, { live }))!;
	assert.equal(key(info, "systemPrompt")!.prompt, live.systemPrompt);
	assert.equal(key(info, "memory")!.prompt, "## AGENTS.md\n\nEmbedded memory");
	assert.equal(key(info, "skills")!.prompt, skillsText);
	assert.ok(key(info, "tools")!.prompt!.includes('"name": "read"'));
	assert.ok(!key(info, "tools")!.prompt!.includes("Inactive tool"));
	assert.ok(key(info, "context")!.prompt!.includes("hello there"));
	assert.equal(key(info, "toolResults")!.prompt, "");
	assert.equal(key(info, "other")!.prompt, undefined);
	assert.equal(key(info, "freeSpace")!.prompt, undefined);
	const withoutEmbedded = (await loadContextUsage(file, { live: { ...live, systemPrompt: "System only" } }))!;
	assert.equal(key(withoutEmbedded, "memory")!.prompt, "");
	assert.equal(key(withoutEmbedded, "skills")!.prompt, "");
});

test("conversation previews separate tool results, retain thinking/calls and respect compaction", async (t) => {
	const dir = tempDir(t);
	const file = makeSession(dir);
	const manager = SessionManager.open(file);
	const kept = manager.appendMessage(userMessage("Kept user prompt", 3));
	manager.appendMessage({
		...assistantMessage("", 4, USAGE),
		content: [
			{ type: "thinking", thinking: "Thought source" },
			{ type: "text", text: "Assistant source" },
			{ type: "toolCall", id: "call1", name: "read", arguments: { path: "source.ts", type: "text", text: "argument text" } },
		],
	} as AnyMessage);
	manager.appendMessage({ role: "toolResult", toolCallId: "call1", toolName: "read", content: [{ type: "text", text: "Tool source" }, { type: "image", mimeType: "image/png", data: "BINARY_PAYLOAD" }], isError: false, timestamp: 5 });
	manager.appendMessage({ role: "bashExecution", command: "echo result", output: "Bash source", exitCode: 0, cancelled: false, truncated: false, timestamp: 6 });
	manager.appendCustomMessageEntry("extension", "Custom source", true);
	manager.appendCompaction("Compaction source", kept, 1000);
	const info = (await loadContextUsage(file))!;
	const context = key(info, "context")!.prompt!;
	const results = key(info, "toolResults")!.prompt!;
	for (const text of ["Kept user prompt", "Thought source", "Assistant source", "source.ts", "Custom source", "Compaction source"]) assert.ok(context.includes(text), text);
	assert.ok(!context.includes("hello there"), "compacted-away messages must not reappear");
	assert.ok(!context.includes("Tool source"));
	assert.ok(context.includes('"type": "text"'), "tool arguments are not interpreted as message content blocks");
	assert.ok(results.includes("Image payload omitted"));
	assert.ok(!results.includes("BINARY_PAYLOAD"));
	for (const text of ["Tool source", "echo result", "Bash source"]) assert.ok(results.includes(text), text);
	assert.equal(key(info, "systemPrompt"), undefined, "historical sessions must not invent live prompt data");
});
