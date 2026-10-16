/**
 * Raw-key debug log (src/ui/key-log.ts) — the LAZY_PANEL_KEY_LOG aid.
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { attachKeyLog, type KeyLogHost } from "../src/ui/key-log.ts";

/** Fake TUI that keeps the registered listeners so the test can feed raw chunks. */
interface FakeHost extends KeyLogHost {
	listeners: Array<(data: string) => { consume?: boolean; data?: string } | undefined>;
	feed: (data: string) => { consume?: boolean; data?: string } | undefined;
}

function fakeHost(): FakeHost {
	const listeners: FakeHost["listeners"] = [];
	return {
		addInputListener: (listener) => {
			listeners.push(listener);
			return () => {
				listeners.splice(listeners.indexOf(listener), 1);
			};
		},
		listeners,
		feed: (data) => listeners.map((listener) => listener(data)).find((result) => result !== undefined),
	};
}

test("attachKeyLog does nothing without LAZY_PANEL_KEY_LOG", () => {
	const host = fakeHost();
	assert.equal(attachKeyLog(host, ""), undefined);
	assert.equal(host.listeners.length, 0);
});

test("attachKeyLog appends every raw chunk with its chord and never consumes it", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "lazy-panel-keylog-"));
	const file = path.join(dir, "keys.log");
	try {
		const host = fakeHost();
		const detach = attachKeyLog(host, file);
		assert.ok(detach);
		// The panel still receives the key: the listener must not consume it.
		assert.equal(host.feed("\x1b[57349u"), undefined);
		host.feed("\x1b[57441u"); // lone modifier: not a chord
		host.feed("a");
		const lines = readFileSync(file, "utf-8").trim().split("\n");
		assert.equal(lines.length, 3);
		assert.match(lines[0]!, /"\\u001b\[57349u"\tdelete/);
		assert.match(lines[1]!, /"\\u001b\[57441u"\t-$/);
		assert.match(lines[2]!, /"a"\ta$/);
		detach!();
		assert.equal(host.listeners.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
