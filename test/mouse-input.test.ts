/**
 * Mouse input parsing for regular-mode terminals (src/ui/mouse-input.ts).
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { attachMouse, isMouseSequence, type MouseHost, MouseTracker, parseSgrMouse, parseSgrMouseChunk, type RawMouse } from "../src/ui/mouse-input.ts";

test("parseSgrMouse decodes SGR press / release to zero-based cells", () => {
	assert.deepEqual(parseSgrMouse("\x1b[<0;5;3M"), { button: 0, x: 4, y: 2, release: false });
	assert.deepEqual(parseSgrMouse("\x1b[<2;12;7m"), { button: 2, x: 11, y: 6, release: true });
	assert.deepEqual(parseSgrMouse("\x1b[<65;1;1M"), { button: 65, x: 0, y: 0, release: false });
	assert.equal(parseSgrMouse("j"), undefined);
	assert.equal(parseSgrMouse("\x1b[A"), undefined, "arrow key is not a mouse sequence");
});

test("isMouseSequence recognises only SGR mouse reports", () => {
	assert.equal(isMouseSequence("\x1b[<0;5;3M"), true);
	assert.equal(isMouseSequence("\x1b[<64;5;3m"), true);
	assert.equal(isMouseSequence("\x1b[3~"), false);
	assert.equal(isMouseSequence("q"), false);
});

test("parseSgrMouseChunk splits a batched trackpad-scroll chunk, rejects mixed chunks", () => {
	// three wheel-down reports coalesced into one read
	const batch = "\x1b[<65;5;3M\x1b[<65;5;3M\x1b[<65;5;3M";
	const rows = parseSgrMouseChunk(batch);
	assert.equal(rows?.length, 3);
	assert.deepEqual(rows?.[0], { button: 65, x: 4, y: 2, release: false });
	// a single report still parses
	assert.equal(parseSgrMouseChunk("\x1b[<0;5;3M")?.length, 1);
	// anything that is not purely mouse sequences is left for key handling
	assert.equal(parseSgrMouseChunk("\x1b[<65;5;3Mj"), undefined);
	assert.equal(parseSgrMouseChunk("j"), undefined);
	assert.equal(parseSgrMouseChunk(""), undefined);
});

const size = () => ({ width: 100, height: 20 });

test("MouseTracker turns wheel reports into wheel events (delta sign, size, modifiers)", () => {
	const t = new MouseTracker({ size, wheelScrollLines: 3 });
	const down = t.feed({ button: 65, x: 10, y: 4, release: false });
	assert.equal(down?.type, "wheel");
	assert.equal(down?.wheelDelta, 3);
	assert.equal(down?.x, 10);
	assert.equal(down?.y, 4);
	assert.equal(down?.width, 100);
	const up = t.feed({ button: 64, x: 2, y: 2, release: false });
	assert.equal(up?.wheelDelta, -3, "button bit 0 clear = scroll up = negative delta");
});

test("MouseTracker emits a click only on same-cell press + release", () => {
	const t = new MouseTracker({ size });
	assert.equal(t.feed({ button: 0, x: 5, y: 6, release: false }), undefined, "press alone is not a click");
	const click = t.feed({ button: 0, x: 5, y: 6, release: true });
	assert.equal(click?.type, "click");
	assert.equal(click?.clickCount, 1);
	assert.equal(click?.x, 5);
	assert.equal(click?.y, 6);
});

test("MouseTracker drops a drag (press and release on different cells)", () => {
	const t = new MouseTracker({ size });
	t.feed({ button: 0, x: 5, y: 6, release: false });
	assert.equal(t.feed({ button: 0, x: 9, y: 6, release: true }), undefined);
});

test("MouseTracker counts a second same-cell click within the window as a double-click", () => {
	let clock = 1000;
	const t = new MouseTracker({ size, doubleClickMs: 400, now: () => clock });
	const press = (x: number, y: number): RawMouse => ({ button: 0, x, y, release: false });
	const release = (x: number, y: number): RawMouse => ({ button: 0, x, y, release: true });

	t.feed(press(5, 6));
	assert.equal(t.feed(release(5, 6))?.clickCount, 1);
	clock += 200; // within 400ms, same cell
	t.feed(press(5, 6));
	assert.equal(t.feed(release(5, 6))?.clickCount, 2);
	clock += 900; // too slow: back to a single click
	t.feed(press(5, 6));
	assert.equal(t.feed(release(5, 6))?.clickCount, 1);
	clock += 100; // fast but a different cell: single click again
	t.feed(press(9, 6));
	assert.equal(t.feed(release(9, 6))?.clickCount, 1);
});

test("MouseTracker ignores the middle / right buttons", () => {
	const t = new MouseTracker({ size });
	t.feed({ button: 1, x: 5, y: 6, release: false });
	assert.equal(t.feed({ button: 1, x: 5, y: 6, release: true }), undefined, "middle button");
	t.feed({ button: 2, x: 5, y: 6, release: false });
	assert.equal(t.feed({ button: 2, x: 5, y: 6, release: true }), undefined, "right button");
});

test("MouseTracker decodes shift / alt / ctrl modifier bits", () => {
	const t = new MouseTracker({ size });
	// left button (bits 0-1 = 0) plus shift (4), alt (8), ctrl (16) → button code 28
	t.feed({ button: 28, x: 5, y: 6, release: false });
	const click = t.feed({ button: 28, x: 5, y: 6, release: true });
	assert.equal(click?.shift, true);
	assert.equal(click?.alt, true);
	assert.equal(click?.ctrl, true);
	assert.equal(click?.button, "left");
});

// -------------------------------------------------------------------------
// attachMouse: the index.ts glue (regular = self-enable, fullscreen = no-op)
// -------------------------------------------------------------------------

function fakeHost(mode: string) {
	const writes: string[] = [];
	let listener: ((data: string) => { consume?: boolean; data?: string } | undefined) | undefined;
	const host: MouseHost = {
		mode,
		terminal: { write: (d) => void writes.push(d), columns: 100, rows: 20 },
		addInputListener: (l) => {
			listener = l;
			return () => {
				listener = undefined;
			};
		},
	};
	return { host, writes, send: (d: string) => listener?.(d), hasListener: () => listener !== undefined };
}

test("attachMouse (regular): enables SGR, routes parsed events, consumes mouse, passes keys, disables on cleanup", () => {
	const events: TuiMouseEvent[] = [];
	const { host, writes, send, hasListener } = fakeHost("regular");
	const cleanup = attachMouse(host, { handleMouse: (e) => void events.push(e) });

	assert.ok(writes[0]?.includes("\x1b[?1000h"), "mouse tracking enabled on attach");
	assert.equal(hasListener(), true);

	// a wheel report is routed and consumed
	assert.deepEqual(send("\x1b[<65;5;3M"), { consume: true });
	assert.equal(events.length, 1);
	assert.equal(events[0]?.type, "wheel");

	// a full click (press + release on the same cell) routes one click event
	send("\x1b[<0;7;4M");
	send("\x1b[<0;7;4m");
	assert.equal(events.at(-1)?.type, "click");

	// non-mouse input passes through untouched and is not routed
	assert.equal(send("j"), undefined);
	assert.equal(events.length, 2);

	cleanup();
	assert.ok(writes.at(-1)?.includes("\x1b[?1000l"), "mouse tracking disabled on cleanup");
	assert.equal(hasListener(), false);
});

test("attachMouse (fullscreen): no-op, pi already handles the mouse", () => {
	const { host, writes, hasListener } = fakeHost("fullscreen");
	const cleanup = attachMouse(host, { handleMouse: () => undefined });
	assert.equal(writes.length, 0, "does not touch mouse tracking");
	assert.equal(hasListener(), false, "adds no input listener");
	cleanup(); // must not throw
});
