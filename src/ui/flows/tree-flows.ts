/**
 * Dialog flows of the TREE pane (and of the tree dialog, which passes its
 * own cursor row): `y` copies a node, `T` labels it, Enter restores to it
 * after the "Summarize branch?" menu. Each exported function is one key's
 * flow; the target travels in the dialog callbacks and everything the panel
 * provides comes through `FlowHost` (see ./host.ts).
 *
 * TREE 面板（以及树对话框）的弹窗流程：y 复制、T 打标签、Enter 恢复（先问怎么处理被放弃的分支）。
 */

import { t } from "../../i18n/index.ts";
import type { RestoreOptions, TreeRow } from "../../types.ts";
import { labelDialogHints, labelDialogTitle } from "../widgets/label-dialog.ts";
import {
	customPromptHints,
	CUSTOM_PROMPT_INDEX,
	customPromptTitle,
	SUMMARY_CHOICES,
	summaryMenu,
	summaryMenuHints,
	summaryMenuTitle,
} from "../widgets/restore-dialog.ts";
import type { FlowHost } from "./host.ts";

/** A tree row plus the session it belongs to: what y / T / Enter act on (the pane's cursor row, or the dialog's). */
export interface TreeTarget {
	file: string;
	row: TreeRow;
}

/** Node TREE Enter restores to, carried through the Summarize branch? menu and the custom prompt. */
interface RestoreTarget {
	file: string;
	entryId: string;
	/** "role: text" of the node, shown in the dialog title bars. */
	subject: string;
}

/** y: copy the node's full text (like /tree ctrl+x). */
export async function copyTreeNode(host: FlowHost, target: TreeTarget | undefined): Promise<void> {
	if (!target) return;
	await copyEntryText(host, target.file, target.row.entryId);
}

/** Copy the full text of `entryId` in `file` to the clipboard (shared by TREE y and CONTENT y). */
export async function copyEntryText(host: FlowHost, file: string, entryId: string): Promise<void> {
	if (!host.actions) {
		host.setStatus(t("status.copyUnavailable"));
		return;
	}
	try {
		const copied = await host.actions.copyNodeText(file, entryId);
		if (host.isDisposed()) return;
		host.setStatus(copied ? t("status.copiedNode") : t("status.noTextToCopy"));
	} catch (err) {
		host.setStatus(t("status.copyFailed", { error: (err as Error).message }));
	}
}

/** T: open the label dialog pre-filled with the node's current label. */
export function openLabelInput(host: FlowHost, target: TreeTarget | undefined): void {
	if (!target) return;
	if (!host.actions) {
		host.setStatus(t("status.labelUnavailable"));
		return;
	}
	const { file, row } = target;
	// 弹窗标题右侧显示是给哪条消息打标签。
	host.openPrompt("label", {
		title: labelDialogTitle(),
		value: row.label ?? "",
		subject: `${row.role}: ${row.text}`,
		hints: labelDialogHints(),
		onSubmit: (v) => void submitLabel(host, file, row.entryId, v),
		onCancel: () => host.closeDialogs(),
	});
}

/** Enter in the label prompt: persist, then reload the tree so the row shows the new label. */
async function submitLabel(host: FlowHost, file: string, entryId: string, value: string): Promise<void> {
	host.closeDialogs();
	if (!host.actions) return;
	const label = value.trim() || undefined;
	try {
		await host.actions.setNodeLabel(file, entryId, label);
		if (host.isDisposed()) return;
		host.setStatus(label ? t("status.labelSet", { label }) : t("status.labelRemoved"));
	} catch (err) {
		host.setStatus(t("status.labelFailed", { error: (err as Error).message }));
		return;
	}
	await host.reloadTree(file, entryId);
}

/**
 * Enter in TREE: continue from the node under the cursor (/tree restore), then close.
 *
 * 和 pi 内置 /tree 一样先问怎么处理被放弃的分支（Summarize branch? 菜单）；光标就在
 * 活动叶子上时 Enter 等于直接进入该会话，不问；pi 的 branchSummary.skipPrompt 打开时也不问。
 */
export function restoreTreeNode(host: FlowHost, target: TreeTarget | undefined): void {
	if (!target) return;
	if (!host.actions) {
		host.setStatus(t("status.restoreUnavailable"));
		return;
	}
	const restore: RestoreTarget = {
		file: target.file,
		entryId: target.row.entryId,
		subject: `${target.row.role}: ${target.row.text}`,
	};
	if (target.row.isLeaf || host.skipSummaryPrompt) {
		void runRestore(host, restore, { summarize: false });
		return;
	}
	openSummaryMenu(host, restore, 0);
}

/** The three-way menu of /tree; `index` is where the cursor starts (Esc from the custom prompt comes back onto that entry). */
function openSummaryMenu(host: FlowHost, target: RestoreTarget, index: number): void {
	host.openMenu("restore", {
		title: summaryMenuTitle(),
		items: summaryMenu().map((m) => m.label),
		initialIndex: index,
		subject: target.subject,
		hints: summaryMenuHints(),
		onSelect: (i) => chooseSummary(host, target, i),
		// Esc：退回 tree 面板，什么都不做（pi 是退回 tree 选择器）。
		onCancel: () => host.closeDialogs(),
	});
}

/** Enter in the menu: restore right away, or ask for the custom instructions first. */
function chooseSummary(host: FlowHost, target: RestoreTarget, index: number): void {
	const choice = SUMMARY_CHOICES[index];
	host.closeDialogs();
	if (!choice) return;
	switch (choice) {
		case "none":
			void runRestore(host, target, { summarize: false });
			return;
		case "summarize":
			void runRestore(host, target, { summarize: true });
			return;
		case "custom":
			openCustomPrompt(host, target);
			return;
	}
}

/** "Summarize with custom prompt": a one-line prompt for the summarizer instructions (pi uses a multi-line editor). */
function openCustomPrompt(host: FlowHost, target: RestoreTarget): void {
	host.openPrompt("restore", {
		title: customPromptTitle(),
		subject: target.subject,
		hints: customPromptHints(),
		onSubmit: (v) => submitCustomPrompt(host, target, v),
		// Esc：退回三选菜单，光标停在 custom prompt 那一项，和 pi 一致。
		onCancel: () => openSummaryMenu(host, target, CUSTOM_PROMPT_INDEX),
	});
}

/** Enter in the custom prompt: summarize with the instructions (blank = pi's default prompt). */
function submitCustomPrompt(host: FlowHost, target: RestoreTarget, value: string): void {
	host.closeDialogs();
	const instructions = value.trim();
	void runRestore(host, target, instructions ? { summarize: true, customInstructions: instructions } : { summarize: true });
}

/** Hand the choice to the actions layer; a summary takes a while, so the footer says so meanwhile. */
async function runRestore(host: FlowHost, target: RestoreTarget, options: RestoreOptions): Promise<void> {
	const actions = host.actions;
	if (!actions) return;
	await host.enter(
		"restore",
		() => actions.restoreNode(target.file, target.entryId, options),
		options.summarize ? t("status.summarizing") : undefined,
	);
}
