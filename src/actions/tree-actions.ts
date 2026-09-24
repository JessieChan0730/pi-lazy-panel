/**
 * Tree actions — side effects triggered from the tree pane.
 *
 *   restore -> ctx.navigateTree(entryId, { summarize, customInstructions })   (/tree Enter)
 *              other session: ctx.switchSession first, then navigate inside withSession
 *   copy    -> copyToClipboard(full entry text)                               (/tree ctrl+x)
 *   label   -> pi.setLabel / SessionManager.appendLabelChange                 (/tree shift+T)
 *
 * No dialogs here: the caller collects the summary choice / label first.
 */

import {
	copyToClipboard,
	type ExtensionAPI,
	type ExtensionCommandContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { EXTENSION_ID } from "../constants.ts";
import { isEffectiveLeaf, loadNodeText } from "../data/tree.ts";
import { t } from "../i18n/index.ts";
import type { EnterOutcome, RestoreOptions } from "../types.ts";
import { isCurrentSession, openSessionFile, resumeSession } from "./session-actions.ts";

/** The slice of the command context `restoreNode` needs; the `withSession` context has the same shape. */
export type RestoreContext = Pick<
	ExtensionCommandContext,
	"sessionManager" | "switchSession" | "navigateTree" | "isIdle" | "abort" | "waitForIdle" | "ui"
>;

type NavigateContext = Pick<RestoreContext, "navigateTree" | "isIdle" | "abort" | "waitForIdle" | "ui">;

/** How long to wait for pi to settle after aborting the current response before giving up. */
const IDLE_TIMEOUT_MS = 15_000;

/** Enter without a choice (the node is the leaf, or pi's `branchSummary.skipPrompt`): no summary. */
const NO_SUMMARY: RestoreOptions = { summarize: false };

/**
 * Continue the conversation from `entryId` of `sessionFile` (what `/tree` does on Enter).
 *
 * 分流和打标签一致：目标是当前会话就直接走 pi 内存里的 `navigateTree`；是其他历史会话就先
 * `switchSession`，再在 pi 给 `withSession` 的新 ctx 里 navigate（切换后旧 ctx 已失效，不能复用）。
 * 光标节点就是活动叶子时不重复 restore，等价于直接进入该会话。
 * `options` 就是 /tree 的三个选择：不做摘要 / 让模型总结被放弃的分支 / 带自定义指令总结。
 *
 * Throws when the file / entry does not exist, pi is busy for too long, the
 * summary needs a model pi does not have, or the switch / navigation was
 * cancelled. A failed navigation *after* a successful switch cannot be thrown
 * back to the panel (pi has already torn it down), so it is reported through
 * the new session's `ui.notify` and the outcome is `switched`.
 */
export async function restoreNode(
	ctx: RestoreContext,
	sessionFile: string,
	entryId: string,
	options: RestoreOptions = NO_SUMMARY,
): Promise<EnterOutcome> {
	const current = isCurrentSession(ctx, sessionFile);
	const manager = current ? ctx.sessionManager : openSessionFile(sessionFile);
	if (!manager.getEntry(entryId)) throw new Error(`entry ${entryId} not found in session`);
	if (isEffectiveLeaf(manager, entryId)) return resumeSession(ctx, sessionFile);
	if (current) {
		await navigateTo(ctx, entryId, options);
		return "restored";
	}
	let outcome: EnterOutcome = "restored";
	await resumeSession(ctx, sessionFile, {
		withSession: async (next) => {
			try {
				await navigateTo(next, entryId, options);
			} catch (err) {
				outcome = "switched";
				next.ui.notify(`restore failed: ${(err as Error).message}`, "error");
			}
		},
	});
	return outcome;
}

/**
 * `navigateTree` refuses to run while pi is still streaming, so do what the
 * built-in /tree does once the user has committed: abort the response, wait for
 * pi to go idle, then move the leaf.
 *
 * 摘要要等模型写完，这期间面板是隐藏的，所以进度写到 pi 自己的 footer 上（`ui.setStatus`），
 * 结束后清掉。扩展 ctx 的 `navigateTree` 把摘要被中止（aborted）也折叠成 `cancelled: true`，
 * 这里分不出是被中止还是被别的扩展否决，只能统一报 cancelled。
 */
async function navigateTo(ctx: NavigateContext, entryId: string, options: RestoreOptions): Promise<void> {
	if (!ctx.isIdle()) {
		ctx.abort();
		await withTimeout(ctx.waitForIdle(), IDLE_TIMEOUT_MS, "pi is still busy; try again once the current response has stopped");
	}
	if (options.summarize) ctx.ui.setStatus(EXTENSION_ID, t("status.summarizing"));
	try {
		const result = await ctx.navigateTree(entryId, navigateOptions(options));
		if (result.cancelled) {
			throw new Error(options.summarize ? "branch summary cancelled" : "restore cancelled by an extension");
		}
	} finally {
		if (options.summarize) ctx.ui.setStatus(EXTENSION_ID, undefined);
	}
}

/** The `navigateTree` options for a choice; `customInstructions` is only set when there is one. */
function navigateOptions(options: RestoreOptions): { summarize: boolean; customInstructions?: string } {
	return options.customInstructions
		? { summarize: options.summarize, customInstructions: options.customInstructions }
		: { summarize: options.summarize };
}

/** Reject with `message` if `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

/**
 * Copy the full text of a tree node to the system clipboard.
 * Resolves to `false` when the entry has no text to copy (like /tree's
 * "Selected entry has no text to copy").
 */
export async function copyNodeText(sessionFile: string, entryId: string): Promise<boolean> {
	const text = loadNodeText(sessionFile, entryId);
	if (!text) return false;
	await copyToClipboard(text);
	return true;
}

/**
 * Set (or clear with `undefined` / "") a label on a tree node.
 *
 * 面板操作的可能是任意历史会话文件：如果就是 pi 当前打开的会话，走 `pi.setLabel`
 * 让 pi 内存里的 SessionManager 同步；否则单独打开该文件追加 label 条目
 * （SessionManager.open 会持久化到 .jsonl）。
 */
export async function labelNode(
	pi: Pick<ExtensionAPI, "setLabel">,
	ctx: Pick<ExtensionCommandContext, "sessionManager">,
	sessionFile: string,
	entryId: string,
	label: string | undefined,
): Promise<void> {
	const value = label?.trim() || undefined;
	if (isCurrentSession(ctx, sessionFile)) {
		pi.setLabel(entryId, value);
		return;
	}
	SessionManager.open(sessionFile).appendLabelChange(entryId, value);
}
