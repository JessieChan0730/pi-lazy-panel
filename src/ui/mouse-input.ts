/**
 * Mouse input for regular (non-fullscreen) TUI mode.
 *
 * pi only turns on terminal mouse tracking in fullscreen mode; in the default
 * regular mode `TuiMainScreen` never enables it, so an overlay's `handleMouse`
 * is never called. When the panel opens in regular mode `index.ts` enables SGR
 * mouse reporting itself (`\x1b[?1000h\x1b[?1006h`), feeds each raw stdin chunk
 * through `parseSgrMouse` + `MouseTracker`, and routes the result to
 * `LazyPanel.handleMouse`. Pure parsing here; no I/O, tested in test/mouse-input.test.ts.
 */

import type { TuiMouseEvent } from "@earendil-works/pi-tui";

/** Enable SGR mouse reporting: button press / release (1000) with SGR encoding (1006). */
export const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
/** Disable what ENABLE_MOUSE turned on (restores the terminal's own scroll / selection). */
export const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1000l";

/** SGR mouse sequence: ESC [ < Cb ; Cx ; Cy (M = press, m = release). */
const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

/** One decoded SGR mouse report (coordinates are zero-based). */
export interface RawMouse {
	/** SGR button code (bit 6 = wheel, bit 5 = motion, bits 0-1 = button, 2 = shift, 3 = alt, 4 = ctrl). */
	button: number;
	x: number;
	y: number;
	/** true for the `m` (release) form. */
	release: boolean;
}

/** Parse one raw stdin chunk into a mouse report, or undefined when it is not an SGR mouse sequence. */
export function parseSgrMouse(data: string): RawMouse | undefined {
	const m = SGR_MOUSE.exec(data);
	if (!m) return undefined;
	return { button: Number.parseInt(m[1]!, 10), x: Number.parseInt(m[2]!, 10) - 1, y: Number.parseInt(m[3]!, 10) - 1, release: m[4] === "m" };
}

/** Same shape without the trailing anchor, so a chunk can be scanned for several reports at once. */
const SGR_MOUSE_G = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

/**
 * Every SGR mouse report in `data`, but only when the whole chunk is nothing but
 * mouse sequences (terminals batch several wheel reports into one read during a
 * fast trackpad scroll). Returns undefined when the chunk holds anything else,
 * so the caller passes it through to normal key handling instead of consuming it.
 */
export function parseSgrMouseChunk(data: string): RawMouse[] | undefined {
	if (!data.startsWith("\x1b[<")) return undefined;
	const out: RawMouse[] = [];
	let last = 0;
	SGR_MOUSE_G.lastIndex = 0;
	for (let m = SGR_MOUSE_G.exec(data); m; m = SGR_MOUSE_G.exec(data)) {
		if (m.index !== last) return undefined; // 中间夹了非鼠标字节
		out.push({ button: Number.parseInt(m[1]!, 10), x: Number.parseInt(m[2]!, 10) - 1, y: Number.parseInt(m[3]!, 10) - 1, release: m[4] === "m" });
		last = SGR_MOUSE_G.lastIndex;
	}
	return last === data.length && out.length > 0 ? out : undefined;
}

/** true when `data` looks like any SGR mouse sequence (so the caller can consume it even if we take no action). */
export function isMouseSequence(data: string): boolean {
	return SGR_MOUSE.test(data);
}

export interface MouseTrackerOptions {
	/** Terminal size for the synthesized event bounds (width drives the hit-test columns). */
	size: () => { width: number; height: number };
	/** Lines per wheel notch (default 3). */
	wheelScrollLines?: number;
	/** A second click on the same cell within this many ms is a double-click (default 400). */
	doubleClickMs?: number;
	/** Injectable clock for the tests. */
	now?: () => number;
}

/**
 * Turns raw SGR reports into the high-level `TuiMouseEvent`s the panel acts on:
 * a `wheel` event per wheel notch, and a `click` (with `clickCount` for
 * double-clicks) on release when press and release land on the same cell. Only
 * the left button drives clicks; drags (press then release on another cell) are
 * dropped. Motion reports are not requested, so a moved pointer simply releases
 * on a different cell and is ignored.
 */
export class MouseTracker {
	private readonly size: () => { width: number; height: number };
	private readonly wheelScrollLines: number;
	private readonly doubleClickMs: number;
	private readonly now: () => number;

	private pressX = -1;
	private pressY = -1;
	private pressed = false;
	private lastClickX = -1;
	private lastClickY = -1;
	private lastClickAt = 0;
	private clickCount = 0;

	constructor(o: MouseTrackerOptions) {
		this.size = o.size;
		this.wheelScrollLines = o.wheelScrollLines ?? 3;
		this.doubleClickMs = o.doubleClickMs ?? 400;
		this.now = o.now ?? (() => Date.now());
	}

	/** Feed a raw report; returns an event to dispatch, or undefined (a press, drag, or non-left button). */
	feed(raw: RawMouse): TuiMouseEvent | undefined {
		// 滚轮：bit 6 置位，低两位 0 = 上滚、1 = 下滚。
		if ((raw.button & 64) !== 0) {
			const dir = raw.button & 3;
			if (dir !== 0 && dir !== 1) return undefined;
			return this.event("wheel", raw, { wheelDelta: (dir === 0 ? -1 : 1) * this.wheelScrollLines });
		}
		// 只有左键驱动单击 / 双击；中键、右键忽略（仍会被调用方 consume 掉）。
		if ((raw.button & 3) !== 0) {
			this.pressed = false;
			return undefined;
		}
		if (!raw.release) {
			// 按下：记住位置，等释放时判定是否为一次点击。
			this.pressed = true;
			this.pressX = raw.x;
			this.pressY = raw.y;
			return undefined;
		}
		// 释放：按下和释放落在同一格才算点击（拖拽会落在别的格，丢弃）。
		const isClick = this.pressed && this.pressX === raw.x && this.pressY === raw.y;
		this.pressed = false;
		if (!isClick) return undefined;
		const now = this.now();
		const again = raw.x === this.lastClickX && raw.y === this.lastClickY && now - this.lastClickAt <= this.doubleClickMs;
		this.clickCount = again ? this.clickCount + 1 : 1;
		this.lastClickX = raw.x;
		this.lastClickY = raw.y;
		this.lastClickAt = now;
		return this.event("click", raw, { clickCount: this.clickCount });
	}

	private event(type: "wheel" | "click", raw: RawMouse, extra: { wheelDelta?: number; clickCount?: number }): TuiMouseEvent {
		const { width, height } = this.size();
		return {
			type,
			button: type === "wheel" ? "none" : "left",
			x: raw.x,
			y: raw.y,
			screenX: raw.x,
			screenY: raw.y,
			width: Math.max(1, width),
			height: Math.max(1, height),
			shift: (raw.button & 4) !== 0,
			alt: (raw.button & 8) !== 0,
			ctrl: (raw.button & 16) !== 0,
			...(extra.wheelDelta === undefined ? {} : { wheelDelta: extra.wheelDelta }),
			...(extra.clickCount === undefined ? {} : { clickCount: extra.clickCount }),
		};
	}
}

/** Just enough of pi-tui's TUI for `attachMouse` (also lets the test use a fake). */
export interface MouseHost {
	/** "regular" or "fullscreen" — pi only tracks the mouse itself in fullscreen. */
	readonly mode: string;
	terminal: { write(data: string): void; columns: number; rows: number };
	addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined): () => void;
}

/** The panel side `attachMouse` drives. */
export interface MouseSink {
	handleMouse(event: TuiMouseEvent): unknown;
}

/**
 * Wire mouse input for a panel. In fullscreen mode pi already tracks the mouse
 * and dispatches to the overlay's `handleMouse`, so this is a no-op. In regular
 * mode pi tracks nothing, so we enable SGR reporting, parse each stdin chunk and
 * route the events to the sink, consuming the raw sequences. Returns a cleanup
 * function that removes the listener and disables reporting.
 */
export function attachMouse(host: MouseHost, sink: MouseSink): () => void {
	if (host.mode === "fullscreen") return () => {};
	host.terminal.write(ENABLE_MOUSE);
	const tracker = new MouseTracker({ size: () => ({ width: host.terminal.columns, height: host.terminal.rows }) });
	const remove = host.addInputListener((data) => {
		const raws = parseSgrMouseChunk(data);
		if (!raws) return undefined;
		for (const raw of raws) {
			const event = tracker.feed(raw);
			if (event) sink.handleMouse(event);
		}
		// 鼠标序列一律吞掉，避免被 pi 当成按键。
		return { consume: true };
	});
	return () => {
		remove();
		host.terminal.write(DISABLE_MOUSE);
	};
}
