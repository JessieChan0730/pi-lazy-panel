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
	// 行的 parentId 指向最近的一个“也是行”的祖先：label 这类不显示的条目被跳过，
	// UI 画树线时才不会出现指向不存在节点的父引用。
	const visit = (node: SessionTreeNode, parentRowId: string | undefined) => {
		const row = toRow(node, parentRowId, activeIds.has(node.entry.id), leafIds.has(node.entry.id));
		if (row) rows.push(row);
		const nextParent = row ? row.entryId : parentRowId;
		for (const child of node.children) visit(child, nextParent);
	};
	for (const root of manager.getTree()) visit(root, undefined);
	return rows;
}

function toRow(node: SessionTreeNode, parentRowId: string | undefined, onActiveBranch: boolean, isLeaf: boolean): TreeRow | undefined {
	const entry = node.entry;
	const described = describeEntry(entry);
	if (!described) return undefined;
	const row: TreeRow = {
		entryId: entry.id,
		role: described.role,
		text: described.text,
		timestamp: Date.parse(entry.timestamp),
		onActiveBranch,
		kind: described.kind,
	};
	if (parentRowId) row.parentId = parentRowId;
	if (node.label) row.label = node.label;
	if (isLeaf) row.isLeaf = true;
	return row;
}

interface Described {
	role: TreeRow["role"];
	kind: TreeRow["kind"];
	text: string;
}

/**
 * Convert a session entry into role/kind/text; `undefined` = never shown.
 *
 * Kinds follow pi's /tree filters: `message` (user / assistant), `tool`
 * (tool results), `system` (system prompts, bash executions, compactions,
 * branch summaries — structural rows pi always shows; branches in real
 * sessions hang off the system prompts, so hiding them would flatten the
 * tree), `meta` (bookkeeping pi hides by default). Texts use pi's bracket
 * style (`[system]`, `[branch summary]: …`) so the dialog reads like /tree.
 *
 * 分类和 pi 一致：system 提示词 / 压缩 / 分支摘要是树的骨架，默认要显示；
 * 只有 model / thinking / name 这些记账条目默认隐藏。
 */
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
				case "bashExecution": {
					const command = (m as { command?: string }).command ?? "";
					return { role: "system", kind: "system", text: `[bash]: ${singleLine(command)}` };
				}
				default:
					// system prompts（pi 的类型里没列 "system"，实际文件里有）和其他 AgentMessage：`[system]` 这种标签。
					return { role: "system", kind: "system", text: `[${String(m.role)}]` };
			}
		}
		case "custom_message":
			if (!entry.display) return undefined;
			return { role: "user", kind: "message", text: `[${entry.customType}] ${textOf(entry.content)}` };
		case "compaction":
			return { role: "system", kind: "system", text: `[compaction: ${Math.round(entry.tokensBefore / 1000)}k tokens]` };
		case "branch_summary":
			return { role: "system", kind: "system", text: `[branch summary]: ${singleLine(entry.summary)}` };
		case "model_change":
			return { role: "system", kind: "meta", text: `[model: ${entry.modelId}]` };
		case "thinking_level_change":
			return { role: "system", kind: "meta", text: `[thinking: ${entry.thinkingLevel}]` };
		case "session_info":
			return { role: "system", kind: "meta", text: `[name: ${entry.name ?? ""}]` };
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

/**
 * Filter tree rows (mirrors /tree ctrl+d/t/u/l/a: default hides bookkeeping
 * only, no-tools also drops tool results). Rows whose parent was filtered out
 * are re-parented to their nearest kept ancestor, so the result is still a
 * forest the tree lines can be drawn from.
 *
 * 过滤掉中间节点后，子节点挂到最近一个保留下来的祖先上，树线才画得出来。
 */
export function applyTreeFilter(rows: TreeRow[], filter: TreeFilter): TreeRow[] {
	if (filter === "all") return rows;
	const keep = (r: TreeRow): boolean => {
		switch (filter) {
			case "default":
				return r.kind !== "meta";
			case "no-tools":
				return r.kind !== "meta" && r.kind !== "tool";
			case "user-only":
				return r.kind === "message" && r.role === "user";
			case "labeled":
				return r.label !== undefined;
		}
	};
	// rows 是先序排列的，父节点一定先于子节点出现，所以一遍就能算出新的 parentId。
	const nearestKept = new Map<string, string | undefined>();
	const out: TreeRow[] = [];
	for (const r of rows) {
		const parent = r.parentId ? nearestKept.get(r.parentId) : undefined;
		if (!keep(r)) {
			nearestKept.set(r.entryId, parent);
			continue;
		}
		nearestKept.set(r.entryId, r.entryId);
		if (parent === r.parentId) out.push(r);
		else {
			const { parentId: _dropped, ...rest } = r;
			out.push(parent ? { ...rest, parentId: parent } : rest);
		}
	}
	return out;
}
