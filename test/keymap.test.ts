/**
 * Keymap tests: chord parsing, multi-key resolution and user-config merging.
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeKeymap, resolveConfig } from "../src/config/config.ts";
import { DEFAULT_KEYMAP } from "../src/config/keymap.ts";
import { chordLabel, compileKeymap, labelsForFocus, matchesKeyId, normalizeKeyStep, parseChord, type ResolveResult, resolveKeys, scopeChain } from "../src/config/keys.ts";

/** Action of a resolve result, or undefined when it did not resolve to one. */
function actionOf(r: ResolveResult): string | undefined {
	return r.kind === "action" ? r.action : undefined;
}

test("normalizeKeyStep: uppercase means shift, modifiers are ordered, named keys are recognised", () => {
	assert.equal(normalizeKeyStep("G"), "shift+g");
	assert.equal(normalizeKeyStep("shift+g"), "shift+g");
	assert.equal(normalizeKeyStep("Shift+Ctrl+D"), "ctrl+shift+d");
	assert.equal(normalizeKeyStep("Tab"), "tab");
	assert.equal(normalizeKeyStep("PageDown"), "pageDown");
	assert.equal(normalizeKeyStep("?"), "?");
	assert.equal(normalizeKeyStep("+"), "+");
	assert.equal(normalizeKeyStep("bogus"), undefined);
	assert.equal(normalizeKeyStep("meta+x"), undefined);
});

test("parseChord: single keys, combos, verbatim sequences and spaced sequences", () => {
	assert.deepEqual(parseChord("j"), ["j"]);
	assert.deepEqual(parseChord("ctrl+d"), ["ctrl+d"]);
	assert.deepEqual(parseChord("gg"), ["g", "g"]);
	assert.deepEqual(parseChord("yy"), ["y", "y"]);
	assert.deepEqual(parseChord("ctrl+w h"), ["ctrl+w", "h"]);
	assert.deepEqual(parseChord("space"), ["space"]);
	assert.deepEqual(parseChord("shift+tab"), ["shift+tab"]);
	assert.equal(parseChord(""), undefined);
	assert.equal(parseChord("ctrl+"), undefined);
});

test("matchesKeyId: raw terminal bytes match canonical ids", () => {
	assert.ok(matchesKeyId("\t", "tab"));
	assert.ok(matchesKeyId("\x1b[Z", "shift+tab"));
	assert.ok(matchesKeyId("G", "shift+g"));
	assert.ok(matchesKeyId("\x04", "ctrl+d"));
	assert.ok(matchesKeyId("?", "?"));
	assert.ok(matchesKeyId("/", "/"));
	// kitty CSI-u for "?" (shift+/) is decoded as a printable
	assert.ok(matchesKeyId("\x1b[47:63;2u", "?"));
	// key release events never match
	assert.equal(matchesKeyId("\x1b[103;1:3u", "g"), false);
	assert.equal(matchesKeyId("x", "y"), false);
});

test("resolveKeys: pane bindings shadow global, multi-key sequences go through pending", () => {
	const bindings = compileKeymap(DEFAULT_KEYMAP);
	// global
	assert.deepEqual(resolveKeys(bindings, "sessions", ["\t"]), { kind: "action", action: "focus-next", scope: "global" });
	assert.deepEqual(resolveKeys(bindings, "sessions", ["l"]), { kind: "action", action: "focus-next", scope: "global" });
	assert.deepEqual(resolveKeys(bindings, "content", ["h"]), { kind: "action", action: "focus-prev", scope: "global" });
	assert.deepEqual(resolveKeys(bindings, "content", ["2"]), { kind: "action", action: "focus-tree", scope: "global" });
	assert.deepEqual(resolveKeys(bindings, "content", ["C"]), { kind: "action", action: "scope-current", scope: "global" });
	assert.deepEqual(resolveKeys(bindings, "content", ["A"]), { kind: "action", action: "scope-all", scope: "global" });
	assert.deepEqual(resolveKeys(bindings, "tree", ["?"]), { kind: "action", action: "help", scope: "global" });
	assert.deepEqual(resolveKeys(bindings, "tree", ["/"]), { kind: "action", action: "search", scope: "global" });
	// "n" is search-next globally but "session-new" in the sessions pane
	assert.equal(actionOf(resolveKeys(bindings, "sessions", ["n"])), "session-new");
	assert.equal(actionOf(resolveKeys(bindings, "tree", ["n"])), "search-next");
	// "l" is focus-next everywhere; the tree pane labels with "T" (like /tree's shift+T)
	assert.equal(actionOf(resolveKeys(bindings, "tree", ["l"])), "focus-next");
	assert.equal(actionOf(resolveKeys(bindings, "tree", ["T"])), "tree-label");
	// gg: first g is pending, second completes
	assert.deepEqual(resolveKeys(bindings, "sessions", ["g"]), { kind: "pending" });
	assert.equal(actionOf(resolveKeys(bindings, "sessions", ["g", "g"])), "go-top");
	assert.deepEqual(resolveKeys(bindings, "sessions", ["g", "x"]), { kind: "none" });
	// content pane is read-only: "y" is not bound there
	assert.deepEqual(resolveKeys(bindings, "content", ["y"]), { kind: "none" });
	assert.deepEqual(resolveKeys(bindings, "sessions", ["z"]), { kind: "none" });
});

test("tree dialog scope: its keys shadow the tree pane's and the global ones, everything else falls through", () => {
	const bindings = compileKeymap(DEFAULT_KEYMAP);
	assert.deepEqual(scopeChain("tree-dialog"), ["tree-dialog", "tree", "global"]);
	assert.deepEqual(scopeChain("tree"), ["tree", "global"]);
	assert.deepEqual(scopeChain("global"), ["global"]);
	// a: filter all (dialog) shadows tree-open (pane); l: the labeled filter shadows focus-next; q shadows quit
	assert.deepEqual(resolveKeys(bindings, "tree-dialog", ["a"]), { kind: "action", action: "tree-filter-all", scope: "tree-dialog" });
	assert.deepEqual(resolveKeys(bindings, "tree-dialog", ["l"]), { kind: "action", action: "tree-filter-labeled", scope: "tree-dialog" });
	assert.deepEqual(resolveKeys(bindings, "tree-dialog", ["q"]), { kind: "action", action: "tree-dialog-close", scope: "tree-dialog" });
	assert.equal(actionOf(resolveKeys(bindings, "tree-dialog", ["d"])), "tree-filter-default");
	// h and ? have no dialog binding: they fall through to global, where the panel switches them off
	assert.deepEqual(resolveKeys(bindings, "tree-dialog", ["h"]), { kind: "action", action: "focus-prev", scope: "global" });
	assert.deepEqual(resolveKeys(bindings, "tree-dialog", ["?"]), { kind: "action", action: "help", scope: "global" });
	// shared keys come from the tree pane, / from global, gg still goes through pending
	assert.deepEqual(resolveKeys(bindings, "tree-dialog", ["z"]), { kind: "action", action: "tree-fold", scope: "tree" });
	assert.deepEqual(resolveKeys(bindings, "tree-dialog", ["j"]), { kind: "action", action: "move-down", scope: "tree" });
	assert.deepEqual(resolveKeys(bindings, "tree-dialog", ["/"]), { kind: "action", action: "search", scope: "global" });
	assert.deepEqual(resolveKeys(bindings, "tree-dialog", ["g"]), { kind: "pending" });
	assert.equal(actionOf(resolveKeys(bindings, "tree-dialog", ["g", "g"])), "go-top");
	// the dialog's own keys mean nothing in the panes
	assert.deepEqual(resolveKeys(bindings, "tree", ["d"]), { kind: "none" });
	assert.equal(actionOf(resolveKeys(bindings, "tree", ["a"])), "tree-open");
	// labels follow the same chain; the user file can override or unbind the dialog scope
	assert.deepEqual(labelsForFocus(DEFAULT_KEYMAP, "tree-dialog", "search"), ["/"]);
	assert.deepEqual(labelsForFocus(DEFAULT_KEYMAP, "tree-dialog", "tree-copy"), ["y"]);
	assert.deepEqual(labelsForFocus(DEFAULT_KEYMAP, "tree-dialog", "tree-filter-labeled"), ["l"]);
	const merged = mergeKeymap(DEFAULT_KEYMAP, { "tree-dialog": { "tree-filter-all": "A", "tree-dialog-close": null } });
	const custom = compileKeymap(merged);
	assert.equal(actionOf(resolveKeys(custom, "tree-dialog", ["A"])), "tree-filter-all");
	assert.equal(actionOf(resolveKeys(custom, "tree-dialog", ["a"])), "tree-open", "unshadowed: falls through to the pane binding");
	assert.equal(actionOf(resolveKeys(custom, "tree-dialog", ["q"])), "quit", "unbound close: falls through to global quit");
});

test("mergeKeymap: user chords replace defaults per action, null unbinds, other actions untouched", () => {
	const warnings: string[] = [];
	const merged = mergeKeymap(
		DEFAULT_KEYMAP,
		{
			global: { help: "F1", "scope-all": ["A", "ctrl+space"] },
			sessions: { "session-delete": "ctrl+d", "session-share": null },
			// @ts-expect-error unknown scope on purpose
			bogus: { quit: "x" },
		},
		warnings,
	);
	assert.equal(merged.global.help, "F1");
	assert.deepEqual(merged.global["scope-all"], ["A", "ctrl+space"]);
	assert.equal(merged.global.quit, DEFAULT_KEYMAP.global.quit);
	assert.equal(merged.sessions["session-delete"], "ctrl+d");
	assert.equal(merged.sessions["session-share"], undefined);
	assert.equal(merged.sessions["session-rename"], "r");
	assert.equal(merged.tree["tree-label"], "T");
	assert.equal(warnings.length, 1);
	assert.match(warnings[0]!, /unknown keymap scope/);
	// defaults must not be mutated
	assert.equal(DEFAULT_KEYMAP.sessions["session-delete"], "d");
	assert.equal(DEFAULT_KEYMAP.global.help, "?");

	// the override is what the resolver sees
	const bindings = compileKeymap(merged);
	assert.equal(actionOf(resolveKeys(bindings, "sessions", ["\x04"])), "session-delete");
	assert.equal(resolveKeys(bindings, "sessions", ["d"]).kind, "none");
	assert.equal(actionOf(resolveKeys(bindings, "sessions", ["\x1bOP"])), "help");
});

test("resolveConfig: invalid values fall back to defaults with warnings", () => {
	const cfg = resolveConfig({ defaultScope: "everything", leftColumnRatio: 5, keymap: { global: { quit: 42 } } });
	assert.equal(cfg.defaultScope, "current-folder");
	assert.equal(cfg.leftColumnRatio, 0.25);
	assert.equal(cfg.keymap.global.quit, DEFAULT_KEYMAP.global.quit);
	assert.equal(cfg.warnings.length, 3);
	const ok = resolveConfig({ defaultScope: "all", defaultSort: "threaded", leftColumnRatio: 0.3 });
	assert.equal(ok.defaultScope, "all");
	assert.equal(ok.defaultSort, "threaded");
	assert.equal(ok.leftColumnRatio, 0.3);
	assert.deepEqual(ok.warnings, []);
	assert.equal(resolveConfig("nope").warnings.length, 1);
});

test("resolveConfig: locale overrides system language or falls back with a warning", () => {
	// 合法值原样保留。
	assert.equal(resolveConfig({ locale: "zh" }).locale, "zh");
	assert.equal(resolveConfig({ locale: "en" }).locale, "en");
	// 未指定时不写入 locale（运行时按系统语言）。
	assert.equal(resolveConfig({}).locale, undefined);
	// 非法值退回系统语言并给出一条 warning。
	const bad = resolveConfig({ locale: "fr" });
	assert.equal(bad.locale, undefined);
	assert.equal(bad.warnings.length, 1);
});

test("chordLabel / labelsForFocus produce readable hints", () => {
	assert.equal(chordLabel("shift+g"), "G");
	assert.equal(chordLabel("G"), "G");
	assert.equal(chordLabel("ctrl+d"), "Ctrl+d");
	assert.equal(chordLabel("gg"), "gg");
	assert.equal(chordLabel("ctrl+w h"), "Ctrl+w h");
	assert.equal(chordLabel("ctrl+shift+g"), "Ctrl+G");
	assert.equal(chordLabel("shift+tab"), "Shift+Tab");
	assert.equal(chordLabel("F1"), "F1");
	assert.equal(chordLabel("down"), "↓");
	assert.deepEqual(labelsForFocus(DEFAULT_KEYMAP, "sessions", "quit"), ["q", "Ctrl+c"]);
	assert.deepEqual(labelsForFocus(DEFAULT_KEYMAP, "sessions", "move-down"), ["j", "↓"]);
});
