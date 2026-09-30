import assert from "node:assert/strict";
import { test } from "node:test";
import type { TuiMode } from "@earendil-works/pi-tui";
import { mountPanelOverlay } from "../src/ui/overlay-lifecycle.ts";

function fixture(mode: TuiMode) {
	const events: string[] = [];
	const tui = {
		mode,
		requestRender(force?: boolean) {
			events.push(force ? "force" : "diff");
		},
	};
	const setHidden = mountPanelOverlay(tui, {
		setHidden(hidden: boolean) {
			events.push(hidden ? "hide" : "show");
		},
	});
	return { events, tui, setHidden };
}

test("regular overlay forces one redraw on mount, leaving ordinary rendering unchanged", () => {
	const { events, tui } = fixture("regular");
	assert.deepEqual(events, ["force"]);
	tui.requestRender();
	tui.requestRender();
	assert.deepEqual(events, ["force", "diff", "diff"]);
});

test("regular overlay redraws after restoring visibility, not when hiding or already visible", () => {
	const { events, setHidden } = fixture("regular");
	setHidden(false);
	setHidden(true);
	setHidden(true);
	assert.deepEqual(events, ["force", "show", "hide", "hide"]);
	setHidden(false);
	setHidden(false);
	assert.deepEqual(events, ["force", "show", "hide", "hide", "show", "force", "show"]);
	setHidden(true);
	setHidden(false);
	assert.deepEqual(events.slice(-3), ["hide", "show", "force"]);
});

test("fullscreen overlay preserves visibility calls without extra redraws", () => {
	const { events, setHidden, tui } = fixture("fullscreen");
	assert.deepEqual(events, []);
	setHidden(true);
	setHidden(false);
	setHidden(false);
	assert.deepEqual(events, ["hide", "show", "show"]);
	tui.requestRender();
	assert.deepEqual(events, ["hide", "show", "show", "diff"]);
});
