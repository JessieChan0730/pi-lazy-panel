/**
 * What a dialog flow (./session-flows.ts, ./tree-flows.ts) needs from the
 * panel. `LazyPanel` implements it with a private object, so the flows never
 * import app.ts and can be driven by a fake host in tests.
 *
 * A flow is the path of one command from its key to its action: check what
 * it needs, open a prompt / menu (the dialog callbacks carry the target),
 * call the action, report in the footer. Flows keep no state of their own.
 *
 * 弹窗流程对面板的全部依赖。flows 只认这个接口、不 import app.ts：分层清楚，也能用假 host 单测。
 */

import type { ResolvedConfig } from "../../config/config.ts";
import type { ContextUsageInfo, EnterOutcome, PanelMode, SessionInfo, SessionRow, TreeFilter } from "../../types.ts";
import type { ActionSource, DataSource, SettingsSource } from "../ports.ts";
import type { PanelState } from "../state.ts";
import type { InputDialogSpec } from "../widgets/input-dialog.ts";
import type { SelectDialogSpec } from "../widgets/select-dialog.ts";

export interface SettingsFlowHost extends FlowHost {
	readonly settingsSource: SettingsSource | undefined;
	closeSettings(): void;
	refreshSettings(): void;
	refreshConfig(config: ResolvedConfig): void;
}

export interface FlowHost {
	/** Shared UI state, including the persisted pin / archive snapshot. */
	readonly state: PanelState;
	readonly data: DataSource;
	/** Side effects; undefined = none wired, which each flow reports in the footer. */
	readonly actions: ActionSource | undefined;
	/** Session pi has open: `d` refuses to delete it. */
	readonly currentSessionFile: string | undefined;
	/** pi's `branchSummary.skipPrompt`: TREE Enter restores without asking. */
	readonly skipSummaryPrompt: boolean;
	/** True once the panel is gone: async flows stop before touching it again. */
	isDisposed(): boolean;
	/** Localised hint using the configured archive-view key (empty when unbound). */
	archiveViewHint(): string;
	/** Footer status text (undefined clears it). */
	setStatus(text: string | undefined): void;
	/** Listed sessions, in display order. */
	sessionRows(): readonly SessionRow[];
	/** Session under the cursor, or undefined with a footer hint. */
	currentSessionRow(): SessionRow | undefined;
	/** Show the text prompt of a flow in `mode` (the menu, if up, closes first). */
	openPrompt(mode: PanelMode, spec: InputDialogSpec): void;
	/** Show the menu of a flow (a picker, a confirmation, an alert) in `mode` (the prompt, if up, closes first). */
	openMenu(mode: PanelMode, spec: SelectDialogSpec): void;
	/** End a flow: close its prompt / menu and go back to the base mode. */
	closeDialogs(): void;
	/** Show the read-only Session Info box: `onCopy` gets its text on `y`, the panel closes it on Esc / q. */
	openInfo(info: SessionInfo, onCopy: (text: string) => void): void;
	/** Show the read-only Context usage box: `onCopy` gets its text on `y`, the panel closes it on Esc / q. */
	openUsage(info: ContextUsageInfo, onCopy: (text: string) => void): void;
	/** Rows a centered menu may show before it scrolls. */
	dialogMaxRows(): number;
	/**
	 * Hand control to pi (resume / restore / new / fork / clone / compact /
	 * import): the panel hides meanwhile, closes on success and shows the
	 * reason in the footer on failure. `progress` is the footer text meanwhile.
	 */
	enter(what: string, run: () => Promise<EnterOutcome>, progress?: string): Promise<void>;
	/** Re-read the sessions list with the cursor on `keepFile` (or clamped); false when listing failed. */
	relist(keepFile: string | undefined): Promise<boolean>;
	/** After the list changed: reload TREE + CONTENT when another session ended up under the cursor. */
	followSessionsCursor(): Promise<void>;
	/** Re-read the tree of `file` with the cursor kept on `entryId`. */
	reloadTree(file: string, entryId: string): Promise<void>;
	/** Apply the filter shared by the TREE pane and its full-size dialog. */
	setTreeFilter(filter: TreeFilter): Promise<void>;
	/** `file` changed on disk: reload its tree (cursor kept) when it is the loaded session, else follow the sessions cursor. */
	refreshSession(file: string): Promise<void>;
}
