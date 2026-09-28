/**
 * Multi-key sequences such as `gg`: the keys of an unfinished sequence are
 * buffered while they are a prefix of some binding, resolved against the
 * keymap scope by scope, and dropped when the next key does not come in
 * time. The panel feeds every key of the panes and of the tree dialog
 * through one sequencer and shows `pendingKeys` in the footer meanwhile.
 *
 * 多键序列（gg）的缓冲：前缀匹配时先存着等下一键，超时就丢掉；面板和树对话框共用这一份。
 */

import { type Binding, type ResolveResult, resolveKeys } from "../config/keys.ts";
import type { KeyScope } from "../types.ts";

/** Max time between keys of a multi-key sequence such as "gg". */
export const PENDING_TIMEOUT_MS = 1000;

export class KeySequencer {
	/** Raw key chunks of the unfinished sequence. */
	private pending: string[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;

	/** `onChange`: the buffered keys changed (a prefix came in, or the timeout dropped it), so the footer should re-render. */
	constructor(
		private readonly bindings: Binding[],
		private readonly onChange: () => void,
		private readonly timeoutMs = PENDING_TIMEOUT_MS,
	) {}

	/** True while a sequence waits for its next key. */
	get hasPending(): boolean {
		return this.pending.length > 0;
	}

	/** The buffered keys, e.g. "g" (empty when none). */
	get pendingKeys(): string {
		return this.pending.join("");
	}

	/**
	 * One raw key: resolve the buffered keys plus this one in `scope` (then the
	 * scopes behind it, see `scopeChain`). A prefix of a longer binding stays
	 * buffered — `onChange` fires and the timeout restarts; any other outcome
	 * empties the buffer and is returned for the caller to act on.
	 */
	feed(scope: KeyScope, data: string): ResolveResult {
		const pressed = [...this.pending, data];
		const result = resolveKeys(this.bindings, scope, pressed);
		if (result.kind === "pending") {
			this.pending = pressed;
			this.arm();
			this.onChange();
			return result;
		}
		this.clear();
		return result;
	}

	/** Drop the buffered keys now (Esc, closing the panel); no `onChange`. */
	clear(): void {
		this.pending = [];
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	private arm(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			if (this.pending.length) {
				this.pending = [];
				this.onChange();
			}
		}, this.timeoutMs);
	}
}
