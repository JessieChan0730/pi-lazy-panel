/**
 * Key chord parsing and matching on top of pi-tui's `matchesKey`.
 *
 * Pure functions, no UI. Responsibilities:
 *   - normalise a user-written chord ("G", "ctrl+d", "gg", "ctrl+w h") into
 *     a sequence of pi-tui key ids ("shift+g", "ctrl+d", ["g","g"], ...)
 *   - match one raw terminal input chunk against one key id
 *   - resolve a (scope, pending keys) pair to an ActionId with multi-key
 *     sequence support (vim-style "gg")
 *
 * 键位解析：用户配置里的 "G" 等价于 "shift+g"，"gg" 会被拆成两步按键序列。
 * 匹配时优先用 pi-tui 的 matchesKey（它已经处理 ctrl/alt/shift/kitty 协议），
 * 再回退到 kitty CSI-u 里解码出来的可打印字符（例如 kitty 终端下的 "?"）。
 */

import { decodeKittyPrintable, isKeyRelease, type KeyId, matchesKey } from "@earendil-works/pi-tui";
import type { ActionId, KeyChord, Keymap, KeyScope, PaneKeymap } from "../types.ts";

/** Key names pi-tui understands that are longer than one character. */
const NAMED_KEYS = new Set([
	"escape",
	"esc",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"delete",
	"insert",
	"clear",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	"f1",
	"f2",
	"f3",
	"f4",
	"f5",
	"f6",
	"f7",
	"f8",
	"f9",
	"f10",
	"f11",
	"f12",
]);

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);

/** Canonical (pi-tui) key ids that make up one chord, in press order. */
export type KeySequence = string[];

/**
 * Normalise one key step. Accepts "G", "shift+g", "Ctrl+D", "Tab", "?".
 * Returns the lowercase pi-tui key id, or undefined when the step is invalid.
 */
export function normalizeKeyStep(step: string): string | undefined {
	const raw = step.trim();
	if (!raw) return undefined;
	// A bare "+" is a valid symbol key; anything else is split on "+".
	const parts = raw === "+" ? ["+"] : raw.split("+").filter((p) => p.length > 0);
	if (parts.length === 0) return undefined;
	const key = parts[parts.length - 1]!;
	const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
	for (const m of mods) if (!MODIFIERS.has(m)) return undefined;

	let base: string;
	if (key.length === 1) {
		// Uppercase letter is shorthand for shift+letter ("G" -> "shift+g").
		if (key >= "A" && key <= "Z") {
			mods.add("shift");
			base = key.toLowerCase();
		} else {
			base = key;
		}
	} else {
		const lower = key.toLowerCase();
		if (!NAMED_KEYS.has(lower)) return undefined;
		// pi-tui spells these two in camelCase.
		base = lower === "pageup" ? "pageUp" : lower === "pagedown" ? "pageDown" : lower;
	}
	const order = ["ctrl", "shift", "alt", "super"].filter((m) => mods.has(m));
	return order.length ? `${order.join("+")}+${base}` : base;
}

/**
 * Parse a chord into a key sequence.
 *   "j"          -> ["j"]
 *   "ctrl+d"     -> ["ctrl+d"]
 *   "gg"         -> ["g", "g"]          (verbatim run of printable chars)
 *   "ctrl+w h"   -> ["ctrl+w", "h"]     (space separated steps)
 *   "G"          -> ["shift+g"]
 * Returns undefined for chords that cannot be parsed.
 */
export function parseChord(chord: KeyChord): KeySequence | undefined {
	const trimmed = chord.trim();
	if (!trimmed) return undefined;
	if (trimmed === "space") return ["space"];
	const steps = trimmed.includes(" ") ? trimmed.split(/\s+/) : [trimmed];
	const out: KeySequence = [];
	for (const step of steps) {
		const single = normalizeKeyStep(step);
		if (single) {
			out.push(single);
			continue;
		}
		// Multi-character run like "gg" / "yy" / "zz": every char must be a plain key.
		if (step.length > 1 && !step.includes("+")) {
			const chars = [...step];
			const ids = chars.map((c) => normalizeKeyStep(c));
			if (ids.every((id): id is string => id !== undefined)) {
				out.push(...ids);
				continue;
			}
		}
		return undefined;
	}
	return out;
}

/** Does one raw terminal input chunk match one canonical key id? */
export function matchesKeyId(data: string, keyId: string): boolean {
	if (isKeyRelease(data)) return false;
	if (matchesKey(data, keyId as KeyId)) return true;
	// kitty 协议下，shift+符号（如 "?"）以 CSI-u 形式到达，matchesKey 不识别，
	// 这里解码成可打印字符再比较一次。
	if (keyId.length === 1) {
		const printable = decodeKittyPrintable(data);
		if (printable === keyId) return true;
	}
	return false;
}

/** One compiled binding: action + the key sequence that triggers it. */
export interface Binding {
	scope: KeyScope;
	action: ActionId;
	seq: KeySequence;
	/** Original chord text, for help display. */
	chord: KeyChord;
}

/** Flatten one scope of the keymap into bindings. Invalid chords are skipped. */
export function compileScope(scope: KeyScope, keymap: PaneKeymap): Binding[] {
	const out: Binding[] = [];
	for (const [action, chords] of Object.entries(keymap) as Array<[ActionId, KeyChord | KeyChord[] | undefined]>) {
		if (chords === undefined) continue;
		for (const chord of Array.isArray(chords) ? chords : [chords]) {
			const seq = parseChord(chord);
			if (seq) out.push({ scope, action, seq, chord });
		}
	}
	return out;
}

export type ResolveResult =
	| { kind: "action"; action: ActionId; scope: KeyScope }
	| { kind: "pending" }
	| { kind: "none" };

/**
 * Resolve the pressed key sequence against the focused pane first, then the
 * global scope. Pane bindings shadow global ones for the same key.
 *
 * `pressed` holds the raw input chunks pressed so far (including the current
 * one). "pending" means some binding starts with this prefix but needs more
 * keys; the caller should buffer and wait.
 */
export function resolveKeys(bindings: Binding[], focus: KeyScope, pressed: string[]): ResolveResult {
	const order: KeyScope[] = focus === "global" ? ["global"] : [focus, "global"];
	let pending = false;
	for (const scope of order) {
		for (const b of bindings) {
			if (b.scope !== scope) continue;
			const state = matchSequence(b.seq, pressed);
			if (state === "match") return { kind: "action", action: b.action, scope };
			if (state === "prefix") pending = true;
		}
		// 当前面板已经有前缀匹配时，不再回退到 global，避免 "g" 被 global 抢走。
		if (pending) return { kind: "pending" };
	}
	return { kind: "none" };
}

function matchSequence(seq: KeySequence, pressed: string[]): "match" | "prefix" | "none" {
	if (pressed.length > seq.length) return "none";
	for (let i = 0; i < pressed.length; i++) {
		if (!matchesKeyId(pressed[i]!, seq[i]!)) return "none";
	}
	return pressed.length === seq.length ? "match" : "prefix";
}

/** Compile a full keymap into a flat binding list. */
export function compileKeymap(keymap: Keymap): Binding[] {
	const scopes: KeyScope[] = ["global", "sessions", "tree", "content"];
	return scopes.flatMap((s) => compileScope(s, keymap[s]));
}

/** Human readable label for a chord, used by the footer and help overlay. */
export function chordLabel(chord: KeyChord): string {
	const seq = parseChord(chord);
	if (!seq) return chord;
	return seq
		.map((id) =>
			id
				.split("+")
				.map((part) => {
					switch (part) {
						case "ctrl":
							return "Ctrl";
						case "shift":
							return "Shift";
						case "alt":
							return "Alt";
						case "super":
							return "Super";
						case "tab":
							return "Tab";
						case "enter":
						case "return":
							return "Enter";
						case "escape":
						case "esc":
							return "Esc";
						case "space":
							return "Space";
						case "up":
							return "↑";
						case "down":
							return "↓";
						case "left":
							return "←";
						case "right":
							return "→";
						default:
							// f1..f12 read better uppercase.
							return /^f\d{1,2}$/.test(part) ? part.toUpperCase() : part;
					}
				})
				.join("+"),
		)
		.join(" ")
		// "Shift+g" reads better as "G".
		.replace(/(^|[\s+])Shift\+([a-z])/g, (_m, pre: string, c: string) => `${pre}${c.toUpperCase()}`);
}

/** All chords bound to `action` in `scope`, as display labels ("j / ↓"). */
export function labelsFor(keymap: Keymap, scope: KeyScope, action: ActionId): string[] {
	const chords = keymap[scope][action];
	if (chords === undefined) return [];
	return (Array.isArray(chords) ? chords : [chords]).map(chordLabel);
}

/** Labels for `action` as seen from `focus`: the pane binding if any, else the global one. */
export function labelsForFocus(keymap: Keymap, focus: KeyScope, action: ActionId): string[] {
	const own = labelsFor(keymap, focus, action);
	return own.length || focus === "global" ? own : labelsFor(keymap, "global", action);
}
