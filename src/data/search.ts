/**
 * Search query parsing and matching.
 *
 * Supports GitHub-style qualifiers in addition to free text:
 *   name:FilmRecall  model:opus  path:FilmRecall  tag:scan
 *   after:2026-09-01  before:2026-09-20
 *
 * Pure functions only — no I/O, no UI.
 *
 * Tree rows are matched the way pi's own /tree search does it: every free-text
 * token (case-insensitive) must appear somewhere in `label + role + text`, so
 * a label is found by typing it. `tag:` narrows to labels, `after:` / `before:`
 * to the entry time; `name:` / `model:` / `path:` only mean something for
 * sessions and are ignored here.
 *
 * TODO: matchSession() and findMatchesInLine() (sessions / content search).
 */

import type { SearchQuery, SessionRow, TreeRow } from "../types.ts";

/** Qualifiers `parseSearchQuery` understands, in `key:value` form. */
const QUALIFIERS = new Set(["name", "model", "path", "tag", "after", "before"]);

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
		query[key as "name" | "model" | "path" | "tag"] = value;
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

export function matchSession(_row: SessionRow, _query: SearchQuery): boolean {
	// TODO
	return true;
}

/**
 * Does a tree row satisfy the query? Free text: every token is contained in
 * `label role text` (like /tree); `tag:` needs a label containing it;
 * `after:` / `before:` bound the entry time. Session-only qualifiers are ignored.
 *
 * 和 pi /tree 的搜索一样：所有词都要出现在 label + role + 正文里（不区分大小写）。
 */
export function matchTreeRow(row: TreeRow, query: SearchQuery): boolean {
	if (query.tag !== undefined && !(row.label ?? "").toLowerCase().includes(query.tag.toLowerCase())) return false;
	if (query.after !== undefined && row.timestamp < query.after.getTime()) return false;
	if (query.before !== undefined && row.timestamp >= query.before.getTime()) return false;
	const tokens = searchTokens(query);
	if (tokens.length === 0) return true;
	const haystack = `${row.label ?? ""} ${row.role} ${row.text}`.toLowerCase();
	return tokens.every((t) => haystack.includes(t));
}

/**
 * Find match ranges of `query.text` inside a line of content, for highlighting
 * and n/N navigation in the content pane.
 */
export function findMatchesInLine(_line: string, _query: SearchQuery): Array<{ start: number; end: number }> {
	// TODO
	return [];
}
