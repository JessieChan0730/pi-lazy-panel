/**
 * Search query parsing and matching.
 *
 * Supports GitHub-style qualifiers in addition to free text:
 *   name:FilmRecall  model:opus  path:FilmRecall  tag:scan
 *   after:2026-09-01  before:2026-09-20
 *
 * Pure functions only — no I/O, no UI.
 *
 * TODO: implement parseSearchQuery(), matchers per pane.
 */

import type { SearchQuery, SessionRow, TreeRow } from "../types.ts";

/** Parse raw input typed after `/` into a structured query. */
export function parseSearchQuery(raw: string): SearchQuery {
	// TODO: tokenize on whitespace, split `key:value`, collect the rest as text
	return { text: raw.trim() };
}

export function matchSession(_row: SessionRow, _query: SearchQuery): boolean {
	// TODO
	return true;
}

export function matchTreeRow(_row: TreeRow, _query: SearchQuery): boolean {
	// TODO
	return true;
}

/**
 * Find match ranges of `query.text` inside a line of content, for highlighting
 * and n/N navigation in the content pane.
 */
export function findMatchesInLine(_line: string, _query: SearchQuery): Array<{ start: number; end: number }> {
	// TODO
	return [];
}
