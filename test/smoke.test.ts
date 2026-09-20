/**
 * Smoke test: the scaffold's pure modules load and expose the expected shape.
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_KEYMAP } from "../src/config/keymap.ts";
import { PANE_IDS } from "../src/constants.ts";
import { parseSearchQuery } from "../src/data/search.ts";

test("default keymap has an entry for every pane", () => {
	for (const pane of PANE_IDS) {
		assert.ok(DEFAULT_KEYMAP[pane], `missing keymap for pane ${pane}`);
	}
	assert.ok(DEFAULT_KEYMAP.global.quit);
});

test("parseSearchQuery returns trimmed free text", () => {
	assert.equal(parseSearchQuery("  hello ").text, "hello");
});
