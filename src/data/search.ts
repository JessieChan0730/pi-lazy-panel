/**
 * Search query parsing and matching.
 *
 * Supports GitHub-style qualifiers in addition to free text:
 *   name:FilmRecall  model:opus  path:FilmRecall  tag:scan  role:user
 *   after:2026-09-01  before:2026-09-20
 *
 * Pure functions only — no I/O, no UI.
 *
 * Free text only looks at what identifies a row — its name / title / label —
 * so a bare word never matches invisible or repetitive fields (the home
 * directory, the model id, the role); those need their qualifier. Every
 * free-text token (case-insensitive) must appear, the qualifiers narrow
 * further, and a qualifier a pane has no field for is ignored:
 *   - tree rows (`matchTreeRow`, the tree pane and the tree dialog): tokens in
 *     `label + text`; `tag:` narrows to labels, `role:` to the role,
 *     `after:` / `before:` to the entry time; `name:` / `model:` / `path:`
 *     are ignored
 *   - session rows (`matchSessionRow`, the sessions pane): tokens in
 *     `name + preview` (what the row's title shows); `name:` narrows to the
 *     name, `model:` / `path:` are the only way to match the model and the
 *     working directory (`path:` accepts the full cwd or its `~` form),
 *     `after:` / `before:` bound the last update; `tag:` / `role:` are ignored
 *   - content lines (`matchesTokens` on the rendered line): tokens only, no
 *     qualifier applies
 * `findMatchRanges` locates the tokens in a piece of text so the panes can
 * highlight them.
 *
 * 三个面板和树对话框共用这里的解析 / 匹配；对话框只用 parseSearchQuery + matchTreeRow。
 * 普通词只搜 名称 / 标题 / label；模型、路径、角色、时间都要加限定词。
 */

import type { SearchQuery, SessionRow, TreeRow } from "../types.ts";
import { shortenPath } from "../utils/format.ts";

/** Qualifiers `parseSearchQuery` understands, in `key:value` form. */
const QUALIFIERS = new Set(["name", "model", "path", "tag", "role", "after", "before"]);

/**
 * Parse raw input typed after `/` into a structured query: whitespace-separated
 * tokens, `key:value` for a known qualifier (the last one wins), everything
 * else joined back into `text`. An unparsable date is kept as text.
 */
export function parseSearchQuery(raw: string): SearchQuery {
	const query: SearchQuery = { text: "" };
	const words: string[] = [];
	for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
		const colon = token.indexOf(":");
		const key = colon > 0 ? token.slice(0, colon).toLowerCase() : "";
		const value = colon > 0 ? token.slice(colon + 1) : "";
		if (!QUALIFIERS.has(key) || !value) {
			words.push(token);
			continue;
		}
		if (key === "after" || key === "before") {
			const date = parseDate(value);
			if (!date) {
				words.push(token);
				continue;
			}
			query[key] = date;
			continue;
		}
		query[key as "name" | "model" | "path" | "tag" | "role"] = value;
	}
	query.text = words.join(" ");
	return query;
}

/** `2026-09-01` → local midnight of that day; anything `Date` cannot parse → undefined. */
function parseDate(value: string): Date | undefined {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
	const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Free-text tokens of a query, lower-cased (empty when the query has no text). */
export function searchTokens(query: SearchQuery): string[] {
	return query.text.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Does `text` contain every token (case-insensitive)? An empty token list matches anything. */
export function matchesTokens(text: string, tokens: string[]): boolean {
	if (tokens.length === 0) return true;
	const haystack = text.toLowerCase();
	return tokens.every((t) => haystack.includes(t));
}

/** Does `value` contain `needle`, case-insensitively? A missing value never does. */
function containsCI(value: string | undefined, needle: string): boolean {
	return (value ?? "").toLowerCase().includes(needle.toLowerCase());
}

/**
 * Does a session row satisfy the query? Free text: every token is contained in
 * `name preview` — the text the row's title is made of. The model and the
 * working directory are deliberately left out: a bare word would otherwise
 * match a fragment of the home directory (`he` in `/home/cheng`) or of the
 * model id (`us` in `opus`) on every session, invisibly. `model:` / `path:`
 * reach those fields on purpose (`path:` matches the full cwd or its `~` form),
 * `name:` needs the name to contain the value, `after:` / `before:` bound the
 * last update. `tag:` only means something for tree rows and is ignored.
 *
 * SESSIONS 面板的匹配：普通词只看 名称 + 首条消息预览（标题那一行的内容）；
 * 模型和路径只通过 model: / path: 匹配，避免家目录、模型名里的碎片让所有会话都命中。
 */
export function matchSessionRow(row: SessionRow, query: SearchQuery): boolean {
	if (query.name !== undefined && !containsCI(row.name, query.name)) return false;
	if (query.model !== undefined && !containsCI(row.model, query.model)) return false;
	if (query.path !== undefined && !containsCI(row.cwd, query.path) && !containsCI(shortenPath(row.cwd), query.path)) return false;
	if (query.after !== undefined && row.updatedAt < query.after.getTime()) return false;
	if (query.before !== undefined && row.updatedAt >= query.before.getTime()) return false;
	return matchesTokens(`${row.name ?? ""} ${row.preview}`, searchTokens(query));
}

/**
 * Does a tree row satisfy the query? Free text: every token is contained in
 * `label text`; `tag:` needs a label containing it, `role:` a role containing
 * it (`user`, `assistant`, `system`, `tool`); `after:` / `before:` bound the
 * entry time. Session-only qualifiers are ignored. Unlike pi's /tree, the role
 * is not part of the free-text haystack (`us` would hit every user row).
 *
 * TREE 的匹配：普通词只看 label + 正文；角色要用 role:，标签可用 tag: 单独限定。
 */
export function matchTreeRow(row: TreeRow, query: SearchQuery): boolean {
	if (query.tag !== undefined && !containsCI(row.label, query.tag)) return false;
	if (query.role !== undefined && !containsCI(row.role, query.role)) return false;
	if (query.after !== undefined && row.timestamp < query.after.getTime()) return false;
	if (query.before !== undefined && row.timestamp >= query.before.getTime()) return false;
	return matchesTokens(`${row.label ?? ""} ${row.text}`, searchTokens(query));
}

/**
 * Everything worth highlighting on a matching row: the free-text tokens plus the
 * values of the text qualifiers (`name:` / `model:` / `path:` / `tag:` /
 * `role:`), so a `model:opus` hit lights up "opus" in the row. Dates have no
 * text to mark.
 */
export function highlightTerms(query: SearchQuery): string[] {
	const out = searchTokens(query);
	for (const value of [query.name, query.model, query.path, query.tag, query.role]) {
		if (value) out.push(value);
	}
	return out;
}

/** A half-open range of code units inside a string (`start` inclusive, `end` exclusive). */
export interface MatchRange {
	start: number;
	end: number;
}

/**
 * Where the `terms` occur in `text` (case-insensitive, every occurrence),
 * merged when they overlap or touch and sorted by position, as code-unit
 * ranges into `text`. Used to highlight matches; empty terms are skipped.
 *
 * 命中位置：每个词在文本里的所有出现（不区分大小写），重叠 / 相邻的段合并，按位置排序。
 */
export function findMatchRanges(text: string, terms: string[]): MatchRange[] {
	const found: MatchRange[] = [];
	for (const term of terms) {
		if (!term) continue;
		// 用正则的 i / u 标志做大小写无关匹配，位置直接落在原文上，不会被 toLowerCase 改变长度的字符带偏。
		const re = new RegExp(escapeRegExp(term), "giu");
		for (const m of text.matchAll(re)) {
			if (m[0].length === 0) break;
			found.push({ start: m.index, end: m.index + m[0].length });
		}
	}
	found.sort((a, b) => a.start - b.start || a.end - b.end);
	const out: MatchRange[] = [];
	for (const r of found) {
		const last = out[out.length - 1];
		if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
		else out.push({ ...r });
	}
	return out;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
