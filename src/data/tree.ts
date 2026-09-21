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
	const rows: TreeRow[] = [];
	// Like pi's /tree: depth only grows at branch points, so a linear chain
	// stays flush-left instead of drifting right one column per entry.
	const visit = (node: SessionTreeNode, depth: number) => {
		const row = toRow(node, depth, activeIds.has(node.entry.id));
		if (row) rows.push(row);
		const childDepth = node.children.length > 1 ? depth + 1 : depth;
		for (const child of node.children) visit(child, childDepth);
	};
	for (const root of manager.getTree()) visit(root, 0);
	return rows;
}

function toRow(node: SessionTreeNode, depth: number, onActiveBranch: boolean): TreeRow | undefined {
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
				case "assistant":
					return { role: "assistant", kind: "message", text: assistantText(m.content) };
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
