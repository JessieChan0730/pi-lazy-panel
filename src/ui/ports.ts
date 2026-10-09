/**
 * What the panel needs from the outside world: the data it shows and the
 * side effects it triggers. `src/index.ts` wires both to src/data/* and
 * src/actions/*; the tests pass in-memory stubs, so the UI layer stays free
 * of I/O.
 *
 * 面板对外的两个端口：只读数据（DataSource）和副作用（ActionSource），由入口注入。
 */

import type { ResolvedConfig } from "../config/config.ts";
import type { ConfigSaveResult, ConfigSnapshot, SettingsPatch } from "../config/config-store.ts";

/** Configuration I/O and runtime language application are injected by the entry point. */
export interface SettingsSource {
	read(): Promise<ConfigSnapshot>;
	save(baseline: ConfigSnapshot, patch: SettingsPatch): Promise<ConfigSaveResult>;
	apply(config: ResolvedConfig): void | Promise<void>;
}

import type {
	ContentBlock,
	ContextUsageInfo,
	DeleteMethod,
	EnterOutcome,
	ExportFormat,
	ExportTarget,
	ForkPoint,
	ListScope,
	RestoreOptions,
	SessionFileChange,
	SessionFileState,
	SessionFileUpdate,
	SessionListFilter,
	SessionInfo,
	SessionRow,
	SessionSortMode,
	ShareResult,
	TreeFilter,
	TreeRow,
} from "../types.ts";

/** Async loaders injected by the entry point (they wrap src/data/*). */
export interface DataSource {
	/** Apply visibility before pinning / threaded sorting. */
	listSessions(scope: ListScope, sort: SessionSortMode, pinned: readonly string[], filter: SessionListFilter): Promise<SessionRow[]>;
	/** Reload shared metadata before listing so other pi windows' changes are seen. */
	loadSessionState?(): Promise<SessionFileState>;
	loadTree(sessionFile: string, filter: TreeFilter): Promise<TreeRow[]>;
	loadContent(sessionFile: string, leafEntryId?: string): Promise<ContentBlock[]>;
	/** `i` in SESSIONS: what /session shows; undefined when the file cannot be read. */
	loadSessionInfo?(sessionFile: string): Promise<SessionInfo | undefined>;
	/** `u` in SESSIONS: context-window usage for the session; undefined when the file cannot be read. */
	loadContextUsage?(sessionFile: string): Promise<ContextUsageInfo | undefined>;
	/** `o` in SESSIONS: the user messages the fork selector lists (empty = nothing to fork). */
	loadForkPoints?(sessionFile: string): Promise<ForkPoint[]>;
	/** `@`: pi's changelog as markdown (what /changelog shows). */
	loadChangelog?(): Promise<string>;
}

/**
 * Side effects injected by the entry point (they wrap src/actions/*).
 * 面板本身不做 I/O：复制、打标签、恢复会话、删除、改名都通过这里交给 actions 层。
 */
export interface ActionSource {
	/** Copy the node's full text to the clipboard; `false` = the entry has no text. */
	copyNodeText(sessionFile: string, entryId: string): Promise<boolean>;
	/** Set, or clear with `undefined`, the label of a node. */
	setNodeLabel(sessionFile: string, entryId: string, label: string | undefined): Promise<void>;
	/** Enter in SESSIONS: make pi show this session (/resume). Rejects with the reason on failure. */
	resumeSession(sessionFile: string): Promise<EnterOutcome>;
	/**
	 * Enter in TREE: continue the conversation from this node (/tree restore),
	 * switching session first if needed; `options` is the summary choice.
	 */
	restoreNode(sessionFile: string, entryId: string, options: RestoreOptions): Promise<EnterOutcome>;
	/** d in SESSIONS (after confirmation): remove the file; resolves to how it was removed. */
	deleteSession?(sessionFile: string): Promise<DeleteMethod>;
	/** Atomically merge a pin / archive / deletion change into the latest metadata. */
	updateSessionState?(change: SessionFileChange): Promise<SessionFileUpdate>;
	/** r in SESSIONS: set the display name ("" clears it). */
	renameSession?(sessionFile: string, name: string): Promise<void>;
	/** n in SESSIONS: start a fresh session, naming it when `name` is non-empty (/new). */
	newSession?(name: string): Promise<EnterOutcome>;
	/** o in SESSIONS (after picking a message and confirming): fork before that user message and open the fork (/fork). */
	forkSession?(sessionFile: string, entryId: string): Promise<EnterOutcome>;
	/** y in SESSIONS (after confirmation): clone the active branch to a new file (/clone). */
	cloneSession?(sessionFile: string): Promise<EnterOutcome>;
	/** c in SESSIONS: compact this conversation's active branch and open it (/compact). */
	compactSession?(sessionFile: string, customInstructions?: string): Promise<EnterOutcome>;
	/** Y in SESSIONS: copy the last assistant reply to the clipboard; `false` = no reply yet. */
	copyLastReply?(sessionFile: string): Promise<boolean>;
	/** y in the Session Info dialog: copy its text to the clipboard. */
	copyText?(text: string): Promise<void>;
	/** e in SESSIONS: where an export goes for what the user typed ("" = pi's default path); synchronous, no writing. */
	exportTarget?(sessionFile: string, format: ExportFormat, input: string): ExportTarget;
	/** e in SESSIONS (once the path is picked, and confirmed when it exists): write the export, resolving to its path (/export). */
	exportSession?(sessionFile: string, format: ExportFormat, outputPath: string): Promise<string>;
	/** I in SESSIONS (after confirmation): copy a session JSONL into the session folder and switch to it (/import). */
	importSession?(input: string): Promise<EnterOutcome>;
	/** S in SESSIONS (after confirmation): upload as a secret GitHub gist (/share). */
	shareSession?(sessionFile: string): Promise<ShareResult>;
}
