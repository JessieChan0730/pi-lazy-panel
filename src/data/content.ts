/**
 * Content data adapter.
 *
 * Produces the `ContentBlock[]` shown in the right-hand pane for a session
 * (or a branch ending at a given tree node), distinguishing user vs assistant
 * messages so they can be rendered in separate boxes.
 */

import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ContentBlock, ForkPoint, SessionInfo } from "../types.ts";
import { normalizeNewlines, singleLine } from "../utils/format.ts";

export interface LoadContentOptions {
	sessionFile: string;
	/** If set, show the branch that ends at this entry instead of the active leaf. */
	leafEntryId?: string;
}

export async function loadContent(options: LoadContentOptions): Promise<ContentBlock[]> {
	const manager = SessionManager.open(options.sessionFile);
	const branch = manager.getBranch(options.leafEntryId ?? resolveContentLeaf(manager));
	const blocks: ContentBlock[] = [];
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const m = entry.message;
		const timestamp = Date.parse(entry.timestamp);
		if (m.role === "user") {
			const markdown = partsToMarkdown(m.content);
			if (markdown) blocks.push({ entryId: entry.id, role: "user", timestamp, markdown });
		} else if (m.role === "assistant") {
			const markdown = assistantToMarkdown(m.content);
			if (markdown) blocks.push({ entryId: entry.id, role: "assistant", timestamp, markdown });
		}
	}
	return blocks;
}

/**
 * Entry id whose branch the panel shows by default.
 *
 * Normally the session's own leaf. Extensions may append bookkeeping entries
 * that move the leaf onto a side branch with no messages at all; in that case
 * fall back to the branch ending at the last message-bearing entry so the
 * user still sees the conversation.
 */
export function resolveContentLeaf(manager: Pick<SessionManager, "getBranch" | "getEntries" | "getLeafId">): string | undefined {
	const leafId = manager.getLeafId() ?? undefined;
	if (leafId && manager.getBranch(leafId).some(isConversation)) return leafId;
	const entries = manager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i]!;
		if (isConversation(e)) return e.id;
	}
	return leafId;
}

/** User / assistant / tool traffic, as opposed to system prompts and bookkeeping entries. */
function isConversation(entry: SessionEntry): boolean {
	if (entry.type === "custom_message") return entry.display;
	if (entry.type !== "message") return false;
	const role = entry.message.role;
	return role === "user" || role === "assistant" || role === "toolResult";
}

/**
 * Every user message in the file, in order, as fork points for `/fork`'s selector.
 *
 * 照搬 pi 内置 /fork 的 `getUserMessagesForForking`：遍历所有条目（不限活动分支），
 * 只取有文字的 user 消息（只有图片的不列），文本压成一行给选择器显示（选择器再按宽度截断）。
 */
export async function loadForkPoints(sessionFile: string): Promise<ForkPoint[]> {
	const manager = SessionManager.open(sessionFile);
	const points: ForkPoint[] = [];
	for (const entry of manager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const text = singleLine(textParts(entry.message.content, " "));
		if (text) points.push({ entryId: entry.id, text });
	}
	return points;
}

/**
 * Text of the last assistant message on the active branch (what `/copy` copies).
 * `undefined` when there is nothing to copy.
 *
 * 照搬 pi 的 `getLastAssistantText`：跳过中止且没有内容的回复，取最后一条回复里的 text 片段
 * 原样拼接（不含思考过程和工具调用）；这条回复只有工具调用时算没有可复制的，不再往前找。
 */
export async function loadLastReply(sessionFile: string): Promise<string | undefined> {
	const manager = SessionManager.open(sessionFile);
	const branch = manager.getBranch(resolveContentLeaf(manager));
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i]!;
		if (entry.type !== "message") continue;
		const m = entry.message;
		if (m.role !== "assistant") continue;
		if (m.stopReason === "aborted" && m.content.length === 0) continue;
		return textParts(m.content, "").trim() || undefined;
	}
	return undefined;
}

/** The `text` parts of a message joined by `separator` (images, thinking and tool calls left out). */
function textParts(content: string | Part[], separator: string): string {
	if (typeof content === "string") return normalizeNewlines(content);
	return content
		.filter((p) => p.type === "text")
		.map((p) => normalizeNewlines(p.text ?? ""))
		.join(separator);
}

type Part = { type: string; text?: string; name?: string; arguments?: Record<string, unknown> };

function partsToMarkdown(content: string | Part[]): string {
	if (typeof content === "string") return normalizeNewlines(content).trim();
	return content
		.map((p) => (p.type === "text" ? normalizeNewlines(p.text ?? "") : p.type === "image" ? "*[image]*" : ""))
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

function assistantToMarkdown(content: Part[]): string {
	const out: string[] = [];
	for (const p of content) {
		if (p.type === "text" && p.text?.trim()) out.push(normalizeNewlines(p.text).trim());
		else if (p.type === "toolCall") out.push(`*→ ${p.name ?? "tool"}${summarizeArgs(p.arguments)}*`);
	}
	return out.join("\n\n");
}

function summarizeArgs(args: Record<string, unknown> | undefined): string {
	if (!args) return "";
	const first = Object.values(args).find((v) => typeof v === "string") as string | undefined;
	if (!first) return "";
	const line = first.split(/\r?\n/)[0] ?? "";
	return ` ${line.length > 60 ? `${line.slice(0, 60)}…` : line}`;
}

/** Gather the data shown by the Session Info dialog (mirrors /session). */
export async function loadSessionInfo(sessionFile: string): Promise<SessionInfo | undefined> {
	let manager: SessionManager;
	try {
		manager = SessionManager.open(sessionFile);
	} catch {
		return undefined;
	}
	const header = manager.getHeader();
	let model: string | undefined;
	let messages = 0;
	let tokens = 0;
	let cost = 0;
	let updatedAt = header ? Date.parse(header.timestamp) : 0;
	for (const entry of manager.getEntries()) {
		updatedAt = Math.max(updatedAt, Date.parse(entry.timestamp));
		if (entry.type === "model_change") model = entry.modelId;
		if (entry.type !== "message") continue;
		const m = entry.message as { role: string; usage?: { input?: number; output?: number; cost?: { total?: number } } };
		if (m.role === "user" || m.role === "assistant") messages++;
		if (m.role === "assistant" && m.usage) {
			tokens += (m.usage.input ?? 0) + (m.usage.output ?? 0);
			cost += m.usage.cost?.total ?? 0;
		}
	}
	const info: SessionInfo = {
		messages,
		tokens,
		cost,
		createdAt: header ? Date.parse(header.timestamp) : 0,
		updatedAt,
		path: sessionFile,
		id: manager.getSessionId(),
	};
	const name = manager.getSessionName();
	if (name) info.name = name;
	if (model) info.model = model;
	return info;
}
