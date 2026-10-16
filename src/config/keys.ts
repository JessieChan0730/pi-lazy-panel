/**
 * Key chord parsing and matching on top of pi-tui's `matchesKey`.
 *
 * Pure functions, no UI. Responsibilities:
 *   - normalise a user-written chord ("G", "ctrl+d", "gg", "ctrl+w h") into
 *     a sequence of pi-tui key ids ("shift+g", "ctrl+d", ["g","g"], ...)
 *   - match one raw terminal input chunk against one key id
 *   - resolve a (scope, pending keys) pair to an ActionId with multi-key
 *     sequence support (vim-style "gg")
 *   - do the reverse for the settings recorder: one raw input chunk back to a
 *     chord (`chordFromKeypress`), so key bindings can be recorded by pressing
 *     the key instead of typing its name
 *
 * 键位解析：用户配置里的 "G" 等价于 "shift+g"，"gg" 会被拆成两步按键序列。
 * 匹配时优先用 pi-tui 的 matchesKey（它已经处理 ctrl/alt/shift/kitty 协议），
 * 再回退到 kitty CSI-u 里解码出来的可打印字符（例如 kitty 终端下的 "?"）。
 */

import { decodeKittyPrintable, isKeyRelease, isKeyRepeat, type KeyId, matchesKey, parseKey } from "@earendil-works/pi-tui";
import { KEY_SCOPES, TREE_DIALOG_SCOPE } from "../constants.ts";
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

/**
 * Keys that can never be bound to an action, in any scope.
 *
 * `escape` is hard-coded by the panel itself — clear the search, clear the
 * multi-select, leave the panel — before the keymap is even consulted, so a
 * binding on it would never fire. `backspace` is what the settings key recorder
 * uses to undo a recorded step, and the text fields need it while editing
 * (search bar, prompts). Only the bare keys are reserved: `ctrl+backspace`
 * is a different key and stays bindable.
 *
 * 任何 scope 都不能绑的两个键：Esc 被面板自己占用（清搜索 / 清多选 / 退出面板，
 * 在键位表之前就吃掉了），Backspace 是设置页录入的“退回”键、输入框也要用。
 * 只禁裸键，`ctrl+backspace` 这类带修饰键的写法仍然是另一个键。
 */
const RESERVED_KEYS = new Set(["escape", "esc", "backspace"]);

/** Is this chord a reserved key that can never be bound (see `RESERVED_KEYS`)? */
export function isReservedKey(chord: string): boolean {
	return RESERVED_KEYS.has(chord.trim().toLowerCase());
}

/** Canonical (pi-tui) key ids that make up one chord, in press order. */
export type KeySequence = string[];

/**
 * Normalise one key step. Accepts "G", "shift+g", "Ctrl+D", "Tab", "?".
 * Returns the lowercase pi-tui key id, or undefined when the step is invalid —
 * including the reserved keys (see `RESERVED_KEYS`).
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
	if (order.length === 0 && RESERVED_KEYS.has(base)) return undefined;
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
		// 保留键的**名字**（"escape" / "esc" / "backspace"）不能再落到下面那段
		// “逐字符拆开”的分支上，否则 "escape" 会被当成 e s c a p e 六个按键。
		if (isReservedKey(step)) return undefined;
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
	// 功能键在 kitty 键盘协议下以 CSI-u functional 形式到达（Delete = \x1b[57349u、F2 = \x1b[57365u），
	// 当前 pi-tui 的 matchesKey 只认 legacy 序列和键盘区的 57421–57426 码位、识别不了这些，
	// 这里补一手。pi 默认开启 kitty 协议（flags=7 含 report event types），她终端里必须有这条路。
	if (matchesKittyFunctionalKey(data, keyId)) return true;
	return false;
}

/**
 * kitty keyboard protocol codepoints of the functional keys. pi-tui only maps
 * the *keypad* variants (57421–57426) and the legacy escape sequences, so in a
 * kitty terminal every one of these arrives as CSI-u and would never match.
 */
const KITTY_FUNCTIONAL_KEYS: Readonly<Record<number, string>> = {
	57344: "escape",
	57345: "enter",
	57346: "tab",
	57347: "backspace",
	57348: "insert",
	57349: "delete",
	57350: "left",
	57351: "right",
	57352: "up",
	57353: "down",
	57354: "pageUp",
	57355: "pageDown",
	57356: "home",
	57357: "end",
	57364: "f1",
	57365: "f2",
	57366: "f3",
	57367: "f4",
	57368: "f5",
	57369: "f6",
	57370: "f7",
	57371: "f8",
	57372: "f9",
	57373: "f10",
	57374: "f11",
	57375: "f12",
};

/** kitty modifier bit values. */
const KITTY_MODIFIER_BITS: Record<string, number> = { shift: 1, alt: 2, ctrl: 4, super: 8 };

/** Caps Lock + Num Lock bits in a kitty modifier report; ignored when matching. */
const KITTY_LOCK_MASK = 64 + 128;

/**
 * Match a kitty CSI-u functional sequence against a chord key id such as "f2",
 * "delete" or "shift+pageUp". Returns false for anything that is not a
 * functional-key CSI-u sequence, so it is a safe fallback after matchesKey.
 */
function matchesKittyFunctionalKey(data: string, keyId: string): boolean {
	// \x1b[<codepoint>u | \x1b[<codepoint>;<mod>u | \x1b[<codepoint>;<mod>:<event>u
	const match = data.match(/^\x1b\[(\d+)(?:;(\d+)(?::\d+)?)?u$/);
	if (!match) return false;
	const parts = keyId.split("+");
	if (parts[parts.length - 1] !== KITTY_FUNCTIONAL_KEYS[Number(match[1])]) return false;
	let expected = 1; // kitty reports (modifier bitmask + 1); 1 = no modifiers.
	for (const mod of parts.slice(0, -1)) expected += KITTY_MODIFIER_BITS[mod] ?? 0;
	const reported = ((match[2] ? Number(match[2]) : 1) - 1 & ~KITTY_LOCK_MASK) + 1;
	return reported === expected;
}

/** Key names the recorder can put into a chord, for the fallback scan below. */
const CAPTURE_KEY_NAMES = [
	"up", "down", "left", "right", "home", "end", "pageUp", "pageDown", "insert", "delete",
	"backspace", "tab", "enter", "space", "escape",
	"f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
];

/** Modifier combinations tried before the bare key, so the most specific chord wins. */
const CAPTURE_MODIFIERS = [["ctrl", "shift"], ["ctrl", "alt"], ["shift", "alt"], ["ctrl", "super"], ["ctrl"], ["shift"], ["alt"], ["super"]];

/** Chords the recorder's fallback scan tries, in order (see `chordFromKeypress`). */
const CAPTURE_CHORDS: KeyChord[] = CAPTURE_KEY_NAMES.flatMap((key) => [
	...CAPTURE_MODIFIERS.map((mods) => [...mods, key].join("+")),
	key,
]);

/**
 * The chord one raw terminal input chunk stands for — the inverse of
 * `matchesKeyId`, as an "press the key you want" recorder needs it.
 *
 * Runs the chunk through pi-tui's mode-aware `parseKey`, normalises the result
 * with `normalizeKeyStep` ("A" → "shift+a") and only in the end keeps it when
 * our own matcher really accepts it back: whatever the recorder stores is
 * guaranteed to fire later. Key releases and auto-repeats (kitty protocol
 * reports both) return undefined so a recorder can ignore them, and so do
 * pastes and anything else that is not a single key.
 *
 * 按键录入用的反向解析：把终端的原始输入还原成 chord 文本（"A" → shift+a）。
 * `parseKey` 认不出的（kitty 协议下的功能键等）再按候选表逐个用 `matchesKeyId` 试，
 * 只有真的认得才返回，保证录进去的键以后一定触发。
 * 注意：单独的修饰键（Ctrl / Shift / Alt / Fn）不是 chord，这里永远返回 undefined。
 */
export function chordFromKeypress(data: string): KeyChord | undefined {
	if (isKeyRelease(data) || isKeyRepeat(data)) return undefined;
	const parsed = parseKey(data);
	const normalized = parsed === undefined ? undefined : normalizeKeyStep(parsed);
	if (normalized !== undefined && matchesKeyId(data, normalized)) return normalized;
	for (const chord of CAPTURE_CHORDS) if (matchesKeyId(data, chord)) return chord;
	return undefined;
}

/** One compiled binding: action + the key sequence that triggers it. */
export interface Binding {
	scope: KeyScope;
	action: ActionId;
	seq: KeySequence;
	/** Original chord text, for help display. */
	chord: KeyChord;
}

/** One action's claim on a key sequence inside one scope; the order is the keymap's own order. */
interface ScopeBinding {
	action: ActionId;
	chord: KeyChord;
	seq: KeySequence;
}

/** Every claim of one scope, in keymap order (the order `resolveKeys` walks). Invalid chords are skipped. */
function scopeBindings(keymap: PaneKeymap): ScopeBinding[] {
	const out: ScopeBinding[] = [];
	for (const [action, chords] of Object.entries(keymap) as Array<[ActionId, KeyChord | KeyChord[] | undefined]>) {
		if (chords === undefined) continue;
		for (const chord of Array.isArray(chords) ? chords : [chords]) {
			const seq = parseChord(chord);
			if (seq) out.push({ action, chord, seq });
		}
	}
	return out;
}

/** Flatten one scope of the keymap into bindings. Invalid chords are skipped. */
export function compileScope(scope: KeyScope, keymap: PaneKeymap): Binding[] {
	return scopeBindings(keymap).map((entry) => ({ scope, ...entry }));
}

/**
 * One contested key sequence inside a scope, seen from the action that was just
 * edited.
 *
 * `dead` — the edited binding can never fire: `other` takes those keys first.
 *   Either it holds a shorter sequence the edited one starts with (a full match
 *   beats a longer sequence still waiting for keys), or it holds the very same
 *   sequence and sits above the edited action in the keymap.
 * `steals` — the edited binding does fire, so `other`'s `otherChord` no longer
 *   does: same sequence below the edited action, or a longer one starting with it.
 *
 * 同一个作用域里两条动作抢同一串按键时的两个方向：`dead` = 刚编辑的这条根本按不出来
 * （`other` 的键更短、或同一条键排在它前面），`steals` = 按得出来，但 `other` 的键被吃掉。
 * 判定照抄 `resolveKeys`：每按一个键，谁先精确匹配谁先拿到 —— 精确匹配永远赢过还在等下一键的
 * 长序列，所以短键不管排第几都赢。
 */
export interface KeyConflict {
	kind: "dead" | "steals";
	/** The other action involved. */
	other: ActionId;
	/** The edited action's chord in the contest (display form). */
	chord: KeyChord;
	/** The other action's chord in the contest — the one that really fires when `kind` is "dead". */
	otherChord: KeyChord;
}

/** Stable identity of one conflict, so a caller can tell "already there" from "just introduced". */
export function conflictKey(conflict: KeyConflict): string {
	return `${conflict.kind}|${conflict.other}|${conflict.chord}|${conflict.otherChord}`;
}

/**
 * What `action`'s own bindings in one scope (`config.keymap[scope]`) contest with
 * the other actions of that scope. Conflicts the action already had are reported
 * too, so a caller can subtract the set it saw before an edit.
 *
 * Two chords of the same action overlapping are not reported: the editor refuses
 * a chord an action already has, and "which of my own two chords wins" is not a
 * question the user asked.
 */
export function keymapConflicts(keymap: PaneKeymap, action: ActionId): KeyConflict[] {
	const entries = scopeBindings(keymap);
	const index = new Map(entries.map((entry, i) => [entry, i]));
	const out: KeyConflict[] = [];
	const seen = new Set<string>();
	const push = (conflict: KeyConflict): void => {
		const key = conflictKey(conflict);
		if (seen.has(key)) return;
		seen.add(key);
		out.push(conflict);
	};
	for (const own of entries) {
		if (own.action !== action) continue;
		// 谁会把我们这串键先拿走：序列是它的前缀，且它要么更短（短键必赢），要么排在我们前面。
		const preemptors = entries.filter((other) => other.action !== action && startsWith(own.seq, other.seq) &&
			(other.seq.length < own.seq.length || index.get(other)! < index.get(own)!));
		if (preemptors.length) {
			for (const other of preemptors) push({ kind: "dead", other: other.action, chord: own.chord, otherChord: other.chord });
			continue;
		}
		// 我们能触发：同一条序列排在我们后面的、以及以我们为前缀的更长的键，都被我们吃掉了。
		for (const other of entries) {
			if (other.action !== action && startsWith(other.seq, own.seq)) push({ kind: "steals", other: other.action, chord: own.chord, otherChord: other.chord });
		}
	}
	return out;
}

/** Does `seq` start with `prefix` (an equal sequence counts)? */
function startsWith(seq: KeySequence, prefix: KeySequence): boolean {
	return prefix.length <= seq.length && prefix.every((key, i) => key === seq[i]);
}

export type ResolveResult =
	| { kind: "action"; action: ActionId; scope: KeyScope }
	| { kind: "pending" }
	| { kind: "none" };

/**
 * Scopes consulted for `focus`, innermost first: a pane shadows the global
 * bindings, the tree dialog shadows the tree pane which shadows global.
 *
 * 键位查找顺序：对话框 → tree 面板 → global；面板 → global。
 */
export function scopeChain(focus: KeyScope): KeyScope[] {
	if (focus === "global") return ["global"];
	if (focus === TREE_DIALOG_SCOPE) return [TREE_DIALOG_SCOPE, "tree", "global"];
	return [focus, "global"];
}

/**
 * Resolve the pressed key sequence against the focused scope first, then the
 * outer ones (see `scopeChain`). Inner bindings shadow outer ones for the same key.
 *
 * `pressed` holds the raw input chunks pressed so far (including the current
 * one). "pending" means some binding starts with this prefix but needs more
 * keys; the caller should buffer and wait.
 */
export function resolveKeys(bindings: Binding[], focus: KeyScope, pressed: string[]): ResolveResult {
	const order = scopeChain(focus);
	let pending = false;
	for (const scope of order) {
		for (const b of bindings) {
			if (b.scope !== scope) continue;
			const state = matchSequence(b.seq, pressed);
			if (state === "match") return { kind: "action", action: b.action, scope };
			if (state === "prefix") pending = true;
		}
		// 当前 scope 已经有前缀匹配时，不再回退到外层，避免 "g" 被 global 抢走。
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
	return KEY_SCOPES.flatMap((s) => compileScope(s, keymap[s]));
}

/** Human readable label for a chord, used by the footer and help overlay. */
export function chordLabel(chord: KeyChord): string {
	const seq = parseChord(chord);
	if (!seq) return chord;
	const steps = seq.map((id) =>
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
			.join("+")
			// "Shift+g" reads better as "G".
			.replace(/(^|\+)Shift\+([a-z])$/, (_m, pre: string, c: string) => `${pre}${c.toUpperCase()}`),
	);
	// vim 风格的纯字母序列（gg / yy）紧挨着显示；带修饰键或命名键的多步序列（ctrl+w h）用空格分开。
	const plainRun = steps.every((s) => [...s].length === 1);
	return steps.join(plainRun ? "" : " ");
}

/** All chords bound to `action` in `scope`, as display labels ("j / ↓"). */
export function labelsFor(keymap: Keymap, scope: KeyScope, action: ActionId): string[] {
	const chords = keymap[scope][action];
	if (chords === undefined) return [];
	return (Array.isArray(chords) ? chords : [chords]).map(chordLabel);
}

/** Labels for `action` as seen from `focus`: the innermost scope of `scopeChain(focus)` that binds it. */
export function labelsForFocus(keymap: Keymap, focus: KeyScope, action: ActionId): string[] {
	for (const scope of scopeChain(focus)) {
		const labels = labelsFor(keymap, scope, action);
		if (labels.length) return labels;
	}
	return [];
}
