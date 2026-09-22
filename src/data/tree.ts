/**
 * Tree data adapter.
 *
 * Builds `TreeRow[]` for a selected session by walking its entry tree
 * (mirrors what pi's `/tree` shows). No UI code here.
 */

import { SessionManager, type SessionEntry, type SessionTreeNode } from "@earendil-works/pi-coding-agent";
import type { TreeFilter, TreeRow } from "../types.ts";
import { singleLine } from "../utils/format.ts";
import { resolveContentLeaf } from "./content.ts";

/** Load the entry tree for a session file. */
export async function loadTree(sessionFile: string): Promise<TreeRow[]> {
	const manager = SessionManager.open(sessionFile);
	const activeIds = new Set(manager.getBranch(resolveContentLeaf(manager)).map((e) => e.id));
	const leafIds = effectiveLeafIds(manager);
	const rows: TreeRow[] = [];
	// Like pi's /tree: depth only grows at branch points, so a linear chain
	// stays flush-left instead of drifting right one column per entry.
	const visit = (node: SessionTreeNode, depth: number) => {
		const row = toRow(node, depth, activeIds.has(node.entry.id), leafIds.has(node.entry.id));
		if (row) rows.push(row);
		const childDepth = node.children.length > 1 ? depth + 1 : depth;
		for (const child of node.children) visit(child, childDepth);
	};
	for (const root of manager.getTree()) visit(root, 0);
	return rows;
}

function toRow(node: SessionTreeNode, depth: number, onActiveBranch: boolean, isLeaf: boolean): TreeRow | undefined {
	const entry = node.entry;
	const described = describeEntry(entry);
	if (!described) return undefined;
	const row: TreeRow = {
		entryId: entry.id,
		depth,
		role: described.role,
		text: described.text,
		timestamp: Date.parse(entry.timestamp),
		onActiveBranch,
		kind: described.kind,
	};
	if (entry.parentId) row.parentId = entry.parentId;
	if (node.label) row.label = node.label;
	if (isLeaf) row.isLeaf = true;
	return row;
}

interface Described {
	role: TreeRow["role"];
	kind: TreeRow["kind"];
	text: string;
}

/** Convert a session entry into role/kind/text; `undefined` = never shown. */
function describeEntry(entry: SessionEntry): Described | undefined {
	switch (entry.type) {
		case "message": {
			const m = entry.message;
			switch (m.role) {
				case "user":
					return { role: "user", kind: "message", text: textOf(m.content) };
				case "assistant": {
					const text = assistantText(m.content);
					// 没有文本、没有工具调用、没有思考的空回复（中断/失败产生），
					// 归到 meta：默认过滤下隐藏，`a` 全部模式仍可见。
					if (text === "(empty)") return { role: "assistant", kind: "meta", text };
					return { role: "assistant", kind: "message", text };
				}
				case "toolResult":
					return { role: "tool", kind: "tool", text: `${m.toolName}: ${textOf(m.content)}` };
				default:
					// system prompts, bash executions and other AgentMessages
					return { role: "system", kind: "meta", text: `${String(m.role)} message` };
			}
		}
		case "custom_message":
			if (!entry.display) return undefined;
			return { role: "user", kind: "message", text: `[${entry.customType}] ${textOf(entry.content)}` };
		case "compaction":
			return { role: "system", kind: "meta", text: `compaction: ${singleLine(entry.summary)}` };
		case "branch_summary":
			return { role: "system", kind: "meta", text: `branch summary: ${singleLine(entry.summary)}` };
		case "model_change":
			return { role: "system", kind: "meta", text: `model → ${entry.modelId}` };
		case "thinking_level_change":
			return { role: "system", kind: "meta", text: `thinking → ${entry.thinkingLevel}` };
		case "session_info":
			return { role: "system", kind: "meta", text: `name → ${entry.name ?? ""}` };
		case "custom":
		case "label":
			return undefined;
	}
}

type Part = { type: string; text?: string; name?: string };

function textOf(content: string | Part[]): string {
	if (typeof content === "string") return singleLine(content);
	return singleLine(
		content
			.map((p) => (p.type === "text" ? (p.text ?? "") : p.type === "image" ? "[image]" : ""))
			.filter(Boolean)
			.join(" "),
	);
}

function assistantText(content: Part[]): string {
	const text = singleLine(
		content
			.filter((p) => p.type === "text")
			.map((p) => p.text ?? "")
			.join(" "),
	);
	if (text) return text;
	const tools = content.filter((p) => p.type === "toolCall").map((p) => p.name ?? "tool");
	if (tools.length) return `→ ${tools.join(", ")}`;
	if (content.some((p) => p.type === "thinking")) return "(thinking)";
	return "(empty)";
}

/**
 * Full text of one entry, for the clipboard (mirrors what /tree ctrl+x copies).
 *
 * - message: bash executions copy the command; other messages copy their text
 *   parts, an assistant message without text falls back to its error message
 * - custom_message: its text parts
 * - compaction / branch_summary: the summary
 * - everything else (labels, model changes…): nothing
 *
 * Returns `undefined` when the entry is missing or has no text.
 */
export function loadNodeText(sessionFile: string, entryId: string): string | undefined {
	const manager = SessionManager.open(sessionFile);
	const entry = manager.getEntry(entryId);
	if (!entry) return undefined;
	let text: string | undefined;
	switch (entry.type) {
		case "message": {
			const m = entry.message as { role: string; command?: string; content?: string | Part[]; errorMessage?: string };
			if (m.role === "bashExecution") text = m.command;
			else if (m.content !== undefined) {
				text = fullText(m.content);
				// 和 /tree 一致：没有正文的 assistant 回复复制它的错误信息。
				if (!text && m.role === "assistant") text = m.errorMessage;
			}
			break;
		}
		case "custom_message":
			text = fullText(entry.content);
			break;
		case "compaction":
		case "branch_summary":
			text = entry.summary;
			break;
		default:
			break;
	}
	return text?.trim() ? text : undefined;
}

/** Concatenate the text parts of a message verbatim (no whitespace collapsing). */
function fullText(content: string | Part[]): string {
	if (typeof content === "string") return content;
	return content.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("");
}

/** Entry types that only record metadata; moving the leaf past them never changes the conversation. */
const BOOKKEEPING_TYPES: ReadonlySet<SessionEntry["type"]> = new Set([
	"label",
	"session_info",
	"model_change",
	"thinking_level_change",
	"custom",
]);

/**
 * Would restoring to `entryId` leave the conversation where it already is?
 *
 * True when the entry is the session's leaf, or when it sits on the active
 * branch with nothing but bookkeeping entries after it (pi appends labels,
 * /name, model / thinking changes and extension state as new leaves, so right
 * after `T` the last message is no longer the raw leaf). User messages are
 * exempt: pi restores those by moving the leaf to their parent and putting the
 * prompt back into the editor, which is a real change.
 *
 * 光标停在活动叶子上时 Enter 不应该再 restore 一次，否则会把刚打的 label /
 * 刚切的模型这些尾部条目甩到分支外。
 */
export function isEffectiveLeaf(manager: Pick<SessionManager, "getLeafId" | "getBranch">, entryId: string): boolean {
	return effectiveLeafIds(manager).has(entryId);
}

/**
 * Every entry `isEffectiveLeaf` holds for, computed in one pass: the leaf
 * itself, then the entries above it for as long as everything after them is
 * bookkeeping (user prompts never qualify, see `isEffectiveLeaf`).
 *
 * 从叶子沿活动分支往上走一次算出整组，loadTree 给每行标 isLeaf 时不用逐行重算。
 */
export function effectiveLeafIds(manager: Pick<SessionManager, "getLeafId" | "getBranch">): Set<string> {
	const ids = new Set<string>();
	const leafId = manager.getLeafId();
	if (!leafId) return ids;
	ids.add(leafId);
	const branch = manager.getBranch(leafId);
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i]!;
		if (entry.id !== leafId && !isUserPrompt(entry)) ids.add(entry.id);
		// 这一条不是记账条目：再往上的节点后面就不再"只剩记账条目"了。
		if (!BOOKKEEPING_TYPES.has(entry.type)) break;
	}
	return ids;
}

/** Entries pi restores into the editor (the leaf moves to their parent), so restoring to them is never a no-op. */
function isUserPrompt(entry: SessionEntry): boolean {
	return entry.type === "custom_message" || (entry.type === "message" && entry.message.role === "user");
}

/** Filter tree rows (mirrors /tree ctrl+d/t/u/l/a). */
export function applyTreeFilter(rows: TreeRow[], filter: TreeFilter): TreeRow[] {
	switch (filter) {
		case "all":
			return rows;
		case "default":
			// /tree default: user + assistant messages, no tool results, no bookkeeping entries.
			return rows.filter((r) => r.kind === "message");
		case "tools":
			return rows.filter((r) => r.kind === "message" || r.kind === "tool");
		case "user-only":
			return rows.filter((r) => r.kind === "message" && r.role === "user");
		case "labeled":
			return rows.filter((r) => r.label !== undefined);
	}
}
