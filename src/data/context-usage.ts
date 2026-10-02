/**
 * Context-usage data adapter (`u` in the sessions pane).
 *
 * Answers "how full is the model's context window for this session, and what
 * fills it" — the number pi shows in its footer, broken down the way pi-cc's
 * `/context` command does: System prompt / Memory / Skills / Tools definition /
 * Tool results / Context, plus Other and Free space, as percentages of the
 * whole window.
 *
 * Two tiers, degrading gracefully:
 *   - the pi *current* session: the full breakdown, because the prompt side
 *     (system prompt, memory files, skills, tool definitions) is live runtime
 *     state handed in via `live`;
 *   - any other session file: only the conversation side (Context + Tool
 *     results) can be read from the file; the prompt side is not stored there,
 *     so it folds into Other. The window is looked up by the model id.
 *
 * Token counts are estimates (`estimateTokens` / chars-4), reconciled against
 * the provider-reported total so the bar matches pi's footer.
 *
 * 只读文件 + pi 内存里的当前会话运行态，产出纯数据 ContextUsageInfo，不写任何东西。
 */

import {
	type BuildSystemPromptOptions,
	calculateContextTokens,
	DEFAULT_COMPACTION_SETTINGS,
	estimateTokens,
	formatSkillsForPrompt,
	getLastAssistantUsage,
	SessionManager,
	type SessionEntry,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import type { ContextUsageCategory, ContextUsageInfo } from "../types.ts";
import { t } from "../i18n/index.ts";
import { resolveContentLeaf } from "./content.ts";

/**
 * Live context data for the pi current session: pi's own usage figure
 * (`ctx.getContextUsage()`, structurally `{ tokens, contextWindow, percent }`;
 * `tokens` null right after compaction), and the runtime prompt inputs that let
 * us itemize the prompt side (system prompt / memory / skills / tool defs).
 */
export interface LiveContextInputs {
	usage: { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
	systemPrompt: string;
	systemPromptOptions: BuildSystemPromptOptions;
	tools: readonly ToolInfo[];
}

export interface LoadContextUsageOptions {
	/** Present when `sessionFile` is pi's current session: the full prompt-side breakdown. */
	live?: LiveContextInputs;
	/** Look up a model's context window by its id (via `ctx.modelRegistry`), for other sessions. */
	findContextWindow?: (modelId: string) => number | undefined;
}

/** Estimate the tokens of an arbitrary value (chars/4, like pi-cc's tool-definition counting). */
function tokenEstimate(value: unknown): number {
	if (!value) return 0;
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return Math.max(0, Math.ceil(text.length / 4));
}

/** Only count a chunk that is actually embedded in the system prompt (avoids double-counting previews). */
function embeddedTokens(prompt: string, chunk: string): number {
	return chunk && prompt.includes(chunk) ? tokenEstimate(chunk) : 0;
}

/** Gather the data shown by the Context usage dialog for `sessionFile`. */
export async function loadContextUsage(sessionFile: string, options: LoadContextUsageOptions = {}): Promise<ContextUsageInfo | undefined> {
	if (!existsSync(sessionFile)) return undefined;
	let manager: SessionManager;
	try {
		manager = SessionManager.open(sessionFile);
	} catch {
		return undefined;
	}
	const live = options.live;
	const branch = manager.getBranch(resolveContentLeaf(manager));
	const model = lastModelId(branch);
	const contextWindow = live?.usage?.contextWindow ?? (model ? options.findContextWindow?.(model) : undefined);

	// 对话侧（任意会话都能从文件算）：工具结果 + 其余上下文。
	const conversation = collectConversation(manager.buildContextEntries());
	// 提示侧（只有当前会话拿得到运行态）：系统提示词 / 记忆 / 技能 / 工具定义。
	const prompt = live ? collectPrompt(live) : undefined;

	const items: ContextUsageCategory[] = [];
	if (prompt) {
		items.push({ key: "systemPrompt", tokens: prompt.systemTokens, color: "accent", prompt: prompt.systemPrompt });
		items.push({ key: "memory", tokens: prompt.memoryTokens, color: "error", prompt: prompt.memoryPrompt });
		items.push({ key: "skills", tokens: prompt.skillsTokens, color: "thinkingMax", prompt: prompt.skillsPrompt });
		items.push({ key: "tools", tokens: prompt.toolTokens, color: "success", prompt: prompt.toolsPrompt });
	}
	items.push({ key: "toolResults", tokens: conversation.toolResultTokens, color: "mdLink", prompt: conversation.toolResultsPrompt });
	items.push({ key: "context", tokens: conversation.contextTokens, color: "warning", prompt: conversation.contextPrompt });

	// 提示侧四项视作"精确"、不参与压缩缩放（capParts 的 fixedPrefix）。
	const fixedPrefix = prompt ? 4 : 0;
	const fixedTokens = items.slice(0, fixedPrefix).reduce((sum, p) => sum + p.tokens, 0);
	const estimated = items.reduce((sum, p) => sum + p.tokens, 0);

	// 总占用：当前会话用 pi footer 那份（含未落盘的最新一轮），否则按最后一条 assistant usage 算。
	const fileUsage = live ? undefined : getLastAssistantUsage(branch);
	const reported = live ? live.usage?.tokens ?? null : fileUsage ? calculateContextTokens(fileUsage) : null;
	const reportedPercent = live?.usage?.percent ?? null;
	const used = Math.max(resolveUsedTokens(reported, reportedPercent, estimated, contextWindow ?? 0), fixedTokens);

	const parts = capParts(items, used, fixedPrefix);
	const attributed = parts.reduce((sum, p) => sum + p.tokens, 0);
	const categories: ContextUsageCategory[] = [
		...parts,
		{ key: "other", tokens: Math.max(0, used - attributed), color: "customMessageLabel" },
	];
	if (contextWindow) categories.push({ key: "freeSpace", tokens: Math.max(0, contextWindow - used), color: "dim" });

	const settings = DEFAULT_COMPACTION_SETTINGS;
	const info: ContextUsageInfo = {
		messages: countMessages(branch),
		used,
		categories,
	};
	if (model) info.model = model;
	if (contextWindow !== undefined) {
		info.contextWindow = contextWindow;
		info.percent = contextWindow > 0 ? used / contextWindow : 0;
		info.compactThreshold = Math.max(0, contextWindow - settings.reserveTokens) / contextWindow;
		info.compactRemaining = Math.max(0, contextWindow - settings.reserveTokens - used);
	}
	const cost = accumulatedCost(branch);
	if (cost !== undefined) info.cost = cost;
	return info;
}

/** Structured tool definitions / arguments stay intact, even when they contain a `type` field. */
function previewValue(value: unknown): string {
	if (typeof value === "string") return value;
	return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

/** Only message content blocks get text extraction / image-payload omission. */
function previewContent(content: string | readonly { type: string }[]): string {
	if (typeof content === "string") return content;
	return content.map((part) => {
		if (part.type === "text" && "text" in part && typeof part.text === "string") return part.text;
		if (part.type === "image") return t("usage.previewImage");
		return previewValue(part);
	}).join("\n\n");
}

/** Prompt-side counts and previews use the same live inputs as pi's context command. */
function collectPrompt(live: LiveContextInputs) {
	const options = live.systemPromptOptions ?? ({ cwd: "" } as BuildSystemPromptOptions);
	const systemPrompt = live.systemPrompt ?? "";
	const selected = new Set(options.selectedTools ?? ["read", "bash", "edit", "write"]);
	let memoryTokens = 0;
	const memory: string[] = [];
	for (const file of options.contextFiles ?? []) {
		memoryTokens += embeddedTokens(systemPrompt, file.content);
		if (file.content && systemPrompt.includes(file.content)) memory.push(`## ${file.path}\n\n${file.content}`);
	}
	const skillsText = formatSkillsForPrompt(options.skills ?? []).trim();
	const skillsTokens = embeddedTokens(systemPrompt, skillsText);
	let toolTokens = 0;
	const tools: string[] = [];
	for (const tool of live.tools) {
		if (!selected.has(tool.name)) continue;
		const definition = { name: tool.name, description: tool.description, parameters: tool.parameters };
		toolTokens += tokenEstimate(definition);
		tools.push(`## ${tool.name}\n\n${previewValue(definition)}`);
	}
	// 系统项展示完整原文（与 pi-cc 一致），计数仍扣除单列的记忆 / 技能。
	const systemTokens = Math.max(0, tokenEstimate(systemPrompt) - memoryTokens - skillsTokens);
	return {
		systemTokens, memoryTokens, skillsTokens, toolTokens,
		systemPrompt,
		memoryPrompt: memory.join("\n\n"),
		skillsPrompt: skillsTokens > 0 ? skillsText : "",
		toolsPrompt: tools.join("\n\n"),
	};
}

/** Conversation previews follow the same compaction-aware entries as the counts. */
function collectConversation(entries: SessionEntry[]) {
	let toolResultTokens = 0;
	let contextTokens = 0;
	const toolResults: string[] = [];
	const context: string[] = [];
	for (const entry of entries) {
		if (entry.type === "message") {
			const message = entry.message;
			if (message.role === "assistant") {
				for (const block of message.content) {
					if (block.type === "toolCall") {
						contextTokens += tokenEstimate(block.name) + tokenEstimate(block.arguments);
						context.push(`## ${t("usage.previewToolCall", { name: block.name })}\n\n${previewValue(block.arguments)}`);
					} else if (block.type === "text") {
						contextTokens += tokenEstimate(block.text);
						context.push(`## ${t("usage.previewAssistant")}\n\n${block.text}`);
					} else if (block.type === "thinking") {
						contextTokens += tokenEstimate(block.thinking);
						context.push(`## ${t("usage.previewThinking")}\n\n${block.thinking}`);
					}
				}
			} else if (message.role === "toolResult") {
				toolResultTokens += estimateTokens(message);
				toolResults.push(`## ${message.toolName}\n\n${previewContent(message.content)}`);
			} else if (message.role === "bashExecution") {
				toolResultTokens += estimateTokens(message);
				toolResults.push(`## ${t("usage.previewCommand")}\n\n${message.command}\n\n## ${t("usage.previewOutput")}\n\n${message.output}`);
			} else {
				contextTokens += estimateTokens(message);
				if (message.role === "compactionSummary" || message.role === "branchSummary") {
					context.push(`## ${t("usage.previewSummary")}\n\n${message.summary}`);
				} else {
					const label = message.role === "user" ? t("usage.previewUser") : message.role;
					context.push(`## ${label}\n\n${previewContent(message.content)}`);
				}
			}
		} else if (entry.type === "compaction" || entry.type === "branch_summary") {
			contextTokens += tokenEstimate(entry.summary);
			context.push(`## ${t("usage.previewSummary")}\n\n${entry.summary}`);
		} else if (entry.type === "custom_message") {
			contextTokens += tokenEstimate(entry.content);
			context.push(`## ${entry.customType}\n\n${previewContent(entry.content)}`);
		}
	}
	return { toolResultTokens, contextTokens, toolResultsPrompt: toolResults.join("\n\n"), contextPrompt: context.join("\n\n") };
}

/**
 * Reconcile the used-token count from the provider report, the footer
 * percentage and the local estimate (ported from pi-cc's resolveUsedTokens):
 * prefer the reported total, fall back to the percentage, then the estimate;
 * distrust a reported total that disagrees with the percentage or is far below
 * the estimate.
 */
function resolveUsedTokens(reported: number | null, percent: number | null, estimated: number, contextWindow: number): number {
	const fromPercent = percent !== null && contextWindow > 0 ? Math.round((percent / 100) * contextWindow) : undefined;
	let resolved = reported ?? fromPercent ?? estimated;
	if (reported !== null && fromPercent !== undefined) {
		const tolerance = Math.max(32, Math.round(contextWindow * 0.001));
		if (Math.abs(reported - fromPercent) > tolerance) resolved = fromPercent;
	}
	if (estimated > 0 && resolved < estimated * 0.25) return estimated;
	return resolved;
}

/**
 * Scale the variable parts (after `fixedPrefix`) so the whole set sums to
 * `target`, leaving the fixed prefix untouched (ported from pi-cc's capParts).
 */
export function capParts(parts: ContextUsageCategory[], target: number, fixedPrefix = 0): ContextUsageCategory[] {
	const fixed = parts.slice(0, fixedPrefix);
	const variable = parts.slice(fixedPrefix);
	const fixedTokens = fixed.reduce((sum, p) => sum + p.tokens, 0);
	const variableTarget = Math.max(0, target - fixedTokens);
	const estimated = variable.reduce((sum, p) => sum + p.tokens, 0);
	if (estimated <= variableTarget || estimated === 0) return parts;
	if (variableTarget === 0) return [...fixed, ...variable.map((p) => ({ ...p, tokens: 0 }))];
	let previous = 0;
	let cumulative = 0;
	const capped = variable.map((part, index) => {
		cumulative += part.tokens;
		const next = index === variable.length - 1 ? variableTarget : Math.round((cumulative / estimated) * variableTarget);
		const tokens = next - previous;
		previous = next;
		return { ...part, tokens };
	});
	return [...fixed, ...capped];
}

/** Cell counts of a stacked bar of `width` columns, one per token value (the last takes the remainder). */
export function usageSegments(tokens: readonly number[], total: number, width: number): number[] {
	if (width <= 0 || tokens.length === 0) return tokens.map(() => 0);
	const denom = Math.max(1, total);
	let remaining = width;
	return tokens.map((value, index) => {
		const cells = index === tokens.length - 1 ? remaining : Math.min(remaining, Math.max(0, Math.round((value / denom) * width)));
		remaining -= cells;
		return cells;
	});
}

/** Model id last selected on the branch (from `model_change` entries). */
function lastModelId(branch: SessionEntry[]): string | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i]!;
		if (entry.type === "model_change") return entry.modelId;
	}
	return undefined;
}

/** User + assistant messages on the branch (same count as the Session Info dialog). */
function countMessages(branch: SessionEntry[]): number {
	let count = 0;
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const role = entry.message.role;
		if (role === "user" || role === "assistant") count++;
	}
	return count;
}

/** Accumulated cost of the branch's assistant messages, or undefined when none report it. */
function accumulatedCost(branch: SessionEntry[]): number | undefined {
	let cost = 0;
	let seen = false;
	for (const entry of branch) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = (entry.message as { usage?: { cost?: { total?: number } } }).usage;
		if (usage?.cost?.total !== undefined) {
			cost += usage.cost.total;
			seen = true;
		}
	}
	return seen ? cost : undefined;
}
